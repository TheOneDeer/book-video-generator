import { NextRequest } from 'next/server';
import { spawn } from 'child_process';
import { writeFileSync, readFileSync, unlinkSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';

interface Segment {
  index: number;
  sentence: string;
  imageUrl?: string;
  audioUrl?: string;
  duration: number;
}

interface ConcatRequest {
  segments: Segment[];
  bookName: string;
  outputDir?: string; // 临时目录路径，如果提供则使用本地文件
}

// 确保FFmpeg路径存在
const FFMPEG_PATH = process.env.FFMPEG_PATH || 'ffmpeg';

async function checkFFmpegAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn(FFMPEG_PATH, ['-version']);
    proc.on('close', (code) => {
      resolve(code === 0);
    });
    proc.on('error', () => {
      resolve(false);
    });
  });
}

async function downloadFileWithRetry(url: string, filename: string, retries = 3): Promise<string> {
  let lastError: Error | null = null;
  
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(30000), // 30秒超时
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const buffer = await response.arrayBuffer();
      const path = `/tmp/${filename}`;
      writeFileSync(path, Buffer.from(buffer));
      return path;
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      
      if (i < retries - 1) {
        // 等待后重试
        await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
      }
    }
  }
  
  throw new Error(`下载失败: ${filename} (${lastError?.message || '未知错误'})`);
}

function runFFmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG_PATH, args);
    
    let stderr = '';
    
    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`FFmpeg failed with code ${code}: ${stderr}`));
      }
    });
    
    proc.on('error', (err) => {
      reject(err);
    });
  });
}

async function createVideoWithKenBurns(
  imagePath: string,
  audioPath: string,
  outputPath: string,
  duration: number
): Promise<void> {
  // 第一步：使用Ken Burns效果生成视频（缩放+平移）
  const zoomFactor = 1.2;
  const zoomSpeed = (zoomFactor - 1) / duration;
  
  const videoArgs = [
    '-loop', '1',
    '-i', imagePath,
    '-i', audioPath,
    '-vf',
    `zoompan=z='min(${zoomFactor},zoom(${zoomFactor},0.001))':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1280x720:fps=30`,
    '-t', duration.toString(),
    '-pix_fmt', 'yuv420p',
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', '23',
    '-c:a', 'aac',
    '-shortest',
    '-y',
    outputPath,
  ];
  
  await runFFmpeg(videoArgs);
}

export async function POST(request: NextRequest) {
  const encoder = new TextEncoder();
  
  // 创建SSE发送函数
  const sendEvent = (controller: ReadableStreamDefaultController, data: any) => {
    const event = `data: ${JSON.stringify(data)}\n\n`;
    controller.enqueue(encoder.encode(event));
  };

  const stream = new ReadableStream({
    async start(controller) {
      let outputDir: string = '';
      let dirCreated = false;

      try {
        // 检查FFmpeg是否可用
        const ffmpegAvailable = await checkFFmpegAvailable();
        if (!ffmpegAvailable) {
          sendEvent(controller, { 
            type: 'error', 
            message: 'FFmpeg不可用，无法进行视频拼接。请确保系统已安装FFmpeg。', 
            progress: 0 
          });
          controller.close();
          return;
        }

        const body: ConcatRequest = await request.json();
        const { segments, bookName, outputDir: providedTempDir } = body;

        if (!segments || segments.length === 0) {
          sendEvent(controller, { type: 'error', message: '没有提供有效的片段数据', progress: 0 });
          controller.close();
          return;
        }

        // 判断是否使用本地文件模式
        const useLocalFiles = !!providedTempDir && segments.some(s => 
          s.imageUrl && !s.imageUrl.startsWith('http') && 
          s.audioUrl && !s.audioUrl.startsWith('http')
        );

        if (useLocalFiles) {
          console.log('使用本地文件模式:', providedTempDir);
        }

        sendEvent(controller, { 
          type: 'progress', 
          step: '开始拼接图片+音频', 
          progress: 5 
        });

        // 验证所有片段都有图片和音频
        const validSegments = segments.filter(s => {
          if (!s.imageUrl || !s.audioUrl) return false;
          
          if (useLocalFiles) {
            // 本地文件模式：检查文件是否存在
            return existsSync(s.imageUrl) && existsSync(s.audioUrl);
          } else {
            // 远程文件模式：检查URL格式
            return s.imageUrl.startsWith('http') && s.audioUrl.startsWith('http');
          }
        });
        
        if (validSegments.length === 0) {
          sendEvent(controller, { 
            type: 'error', 
            message: useLocalFiles 
              ? '所有片段的本地文件都不存在。请确保文件路径正确。'
              : '所有片段都缺少有效的图片或音频。请确保所有片段都已成功生成。', 
            progress: 0 
          });
          controller.close();
          return;
        }
        
        if (validSegments.length < segments.length) {
          const skipped = segments.length - validSegments.length;
          console.warn(`跳过 ${skipped} 个无效片段`);
        }

        // 确定输出目录
        if (useLocalFiles && providedTempDir) {
          outputDir = providedTempDir;
          dirCreated = false; // 使用现有目录，不需要清理
        } else {
          outputDir = `/tmp/concat_${Date.now()}`;
          mkdirSync(outputDir, { recursive: true });
          dirCreated = true;
        }

        sendEvent(controller, { 
          type: 'progress', 
          step: useLocalFiles ? '准备本地文件...' : '下载资源中...', 
          progress: 10 
        });

        const videoPaths: string[] = [];

        for (let i = 0; i < validSegments.length; i++) {
          const segment = validSegments[i];
          const progress = 10 + Math.floor((i / validSegments.length) * 25);
          
          sendEvent(controller, { 
            type: 'progress', 
            step: useLocalFiles 
              ? `准备片段 ${i + 1}/${validSegments.length}` 
              : `下载片段 ${i + 1}/${validSegments.length}`, 
            progress 
          });

          let imagePath: string;
          let audioPath: string;
          
          if (useLocalFiles) {
            // 使用本地文件
            imagePath = segment.imageUrl!;
            audioPath = segment.audioUrl!;
          } else {
            // 下载文件到本地
            imagePath = await downloadFileWithRetry(segment.imageUrl!, `image_${i}.jpg`);
            audioPath = await downloadFileWithRetry(segment.audioUrl!, `audio_${i}.mp3`);
          }
          
          const videoPath = join(outputDir, `video_${i}.mp4`);
          
          sendEvent(controller, { 
            type: 'progress', 
            step: `处理片段 ${i + 1}/${validSegments.length} (Ken Burns效果)...`, 
            progress: 10 + Math.floor((i / validSegments.length) * 25) + 10
          });

          // 使用Ken Burns效果生成带音频的视频
          await createVideoWithKenBurns(imagePath, audioPath, videoPath, segment.duration);
          
          videoPaths.push(videoPath);
        }

        // 拼接所有视频片段
        sendEvent(controller, { 
          type: 'progress', 
          step: '拼接视频片段...', 
          progress: 60 
        });

        // 使用xfade添加转场效果
        if (validSegments.length > 1) {
          // 有多个片段，使用xfade淡入淡出转场
          const transitionDuration = 1; // 转场时长1秒
          
          // 构建复杂的滤镜链
          let filterComplex = '';
          const inputs: string[] = [];
          
          for (let i = 0; i < videoPaths.length; i++) {
            inputs.push(`-i`, videoPaths[i]);
          }
          
          // 为每个输入创建流引用
          const streams: string[] = [];
          for (let i = 0; i < videoPaths.length; i++) {
            streams.push(`[${i}:v][${i}:a]`);
          }
          
          // 构建xfade滤镜链
          let currentStream = '';
          for (let i = 0; i < videoPaths.length; i++) {
            if (i === 0) {
              currentStream = streams[i].replace(`[${i}:v][${i}:a]`, `[v0][a0]`);
            } else if (i === videoPaths.length - 1) {
              // 最后一个片段，直接拼接
              filterComplex += `${currentStream}[v${i-1}][a${i-1}]${streams[i]}concat=n=${videoPaths.length}:v=1:a=1[outv][outa]`;
            } else {
              // 中间片段，使用xfade转场
              const prevDuration = validSegments[i - 1].duration;
              const xfadeStart = prevDuration - transitionDuration;
              
              filterComplex += `${currentStream}[v${i-1}][a${i-1}]${streams[i]}xfade=transition=fade:duration=${transitionDuration}:offset=${xfadeStart}[v${i}][a${i}];`;
              currentStream = `[v${i}][a${i}]`;
            }
          }
          
          const outputPath = join(outputDir, 'final.mp4');
          const concatArgs = [
            ...inputs,
            '-filter_complex', filterComplex,
            '-map', '[outv]',
            '-map', '[outa]',
            '-c:v', 'libx264',
            '-preset', 'fast',
            '-crf', '23',
            '-c:a', 'aac',
            '-shortest',
            '-y',
            outputPath,
          ];
          
          await runFFmpeg(concatArgs);
        } else {
          // 只有一个片段，直接使用
          const outputPath = join(outputDir, 'final.mp4');
          const singleArgs = [
            '-i', videoPaths[0],
            '-c', 'copy',
            '-y',
            outputPath,
          ];
          
          await runFFmpeg(singleArgs);
        }

        const outputPath = join(outputDir, 'final.mp4');

        sendEvent(controller, { 
          type: 'progress', 
          step: '上传最终视频...', 
          progress: 90 
        });

        // 读取最终视频文件
        const videoBuffer = readFileSync(outputPath);

        // 上传到对象存储
        const s3Upload = await fetch('https://storage.tiktoken.cloud/api/upload', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream',
            'X-File-Name': `${bookName}-讲解视频-${Date.now()}.mp4`,
            'X-Content-Type': 'video/mp4',
          },
          body: videoBuffer,
        });

        if (!s3Upload.ok) {
          throw new Error('视频上传失败');
        }

        const uploadResult = await s3Upload.json();
        const finalVideoUrl = uploadResult.url;

        // 清理临时文件
        try {
          rmSync(outputDir, { recursive: true, force: true });
        } catch (err) {
          console.error('清理临时文件失败:', err);
        }

        sendEvent(controller, { 
          type: 'complete', 
          step: '完成', 
          progress: 100,
          data: { videoUrl: finalVideoUrl }
        });

        controller.close();
      } catch (err) {
        console.error('拼接图片+音频失败:', err);
        const errorMessage = err instanceof Error ? err.message : '未知错误';
        sendEvent(controller, { 
          type: 'error', 
          message: errorMessage, 
          progress: 0 
        });
        controller.close();
      } finally {
        // 确保清理临时目录
        if (dirCreated) {
          try {
            rmSync(outputDir, { recursive: true, force: true });
          } catch (err) {
            console.error('清理临时目录失败:', err);
          }
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
