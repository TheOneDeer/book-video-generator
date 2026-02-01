import { NextRequest } from 'next/server';
import fs from 'fs';
import path from 'path';

interface ProgressEvent {
  type: 'progress' | 'error' | 'complete';
  step: string;
  message: string;
  data?: any;
  progress: number;
}

export async function POST(request: NextRequest) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (event: ProgressEvent) => {
        try {
          if (controller.desiredSize === null) {
            console.warn('Controller 已关闭，跳过事件发送:', event.type);
            return;
          }
          const jsonStr = JSON.stringify(event);
          const data = `data: ${jsonStr}\n\n`;
          controller.enqueue(encoder.encode(data));
        } catch (e) {
          console.error('发送事件失败:', e);
        }
      };

      try {
        const { tempDir, segments } = await request.json();

        if (!tempDir || !segments || !Array.isArray(segments)) {
          sendEvent({
            type: 'error',
            step: '初始化',
            message: '缺少必要参数',
            progress: 0,
          });
          controller.close();
          return;
        }

        sendEvent({
          type: 'progress',
          step: '初始化',
          message: '准备拼接视频...',
          progress: 5,
        });

        // 检查临时目录是否存在
        if (!fs.existsSync(tempDir)) {
          sendEvent({
            type: 'error',
            step: '初始化',
            message: '临时目录不存在，请重新生成视频',
            progress: 0,
          });
          controller.close();
          return;
        }

        // 检查 FFmpeg 是否可用
        let ffmpegAvailable = false;
        try {
          const { spawn } = await import('child_process');
          await new Promise((resolve) => {
            const ffmpeg = spawn('ffmpeg', ['-version']);
            ffmpeg.on('close', (code) => {
              ffmpegAvailable = code === 0;
              resolve(code === 0);
            });
            ffmpeg.on('error', () => resolve(false));
            setTimeout(() => resolve(false), 5000);
          });
        } catch {
          ffmpegAvailable = false;
        }

        if (!ffmpegAvailable) {
          sendEvent({
            type: 'error',
            step: '初始化',
            message: 'FFmpeg 不可用，无法拼接视频',
            progress: 0,
          });
          controller.close();
          return;
        }

        sendEvent({
          type: 'progress',
          step: '准备文件',
          message: '检查视频片段...',
          progress: 10,
        });

        // 获取所有视频片段的路径
        const videoPaths = segments
          .filter((s: any) => s.videoUrl)
          .map((s: any) => path.join(tempDir, `segment_${s.index}.mp4`));

        if (videoPaths.length === 0) {
          sendEvent({
            type: 'error',
            step: '准备文件',
            message: '没有找到可拼接的视频片段',
            progress: 0,
          });
          controller.close();
          return;
        }

        if (videoPaths.length === 1) {
          sendEvent({
            type: 'error',
            step: '准备文件',
            message: '只有一个视频片段，无需拼接',
            progress: 0,
          });
          controller.close();
          return;
        }

        // 检查所有视频文件是否存在
        const missingFiles = videoPaths.filter(p => !fs.existsSync(p));
        if (missingFiles.length > 0) {
          sendEvent({
            type: 'error',
            step: '准备文件',
            message: `部分视频文件缺失: ${missingFiles.join(', ')}`,
            progress: 0,
          });
          controller.close();
          return;
        }

        sendEvent({
          type: 'progress',
          step: '拼接视频',
          message: `正在拼接 ${videoPaths.length} 个视频片段...`,
          progress: 20,
        });

        // 拼接视频
        const outputPath = path.join(tempDir, 'final_video.mp4');
        await concatVideos(videoPaths, outputPath);

        sendEvent({
          type: 'progress',
          step: '完成',
          message: '视频拼接完成！',
          progress: 90,
        });

        // 读取拼接后的视频
        const videoBuffer = fs.readFileSync(outputPath);
        const finalVideoUrl = `data:video/mp4;base64,${videoBuffer.toString('base64')}`;

        // 清理临时文件
        try {
          fs.rmSync(tempDir, { recursive: true, force: true });
        } catch (e) {
          console.error('清理临时文件失败：', e);
        }

        sendEvent({
          type: 'progress',
          step: '完成',
          message: '临时文件已清理',
          progress: 95,
        });

        sendEvent({
          type: 'complete',
          step: '完成',
          message: '拼接完成！',
          data: {
            videoUrl: finalVideoUrl,
          },
          progress: 100,
        });

        controller.close();
      } catch (error) {
        console.error('拼接视频时出错：', error);
        sendEvent({
          type: 'error',
          step: '错误',
          message: error instanceof Error ? error.message : '拼接视频失败',
          progress: 0,
        });
        controller.close();
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

// 拼接多个视频
async function concatVideos(videoPaths: string[], outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const { spawn } = require('child_process');

    // 创建 concat 列表文件
    const listFile = path.join(path.dirname(outputPath), 'concat_list.txt');
    const listContent = videoPaths.map(p => `file '${p}'`).join('\n');
    fs.writeFileSync(listFile, listContent);

    const ffmpeg = spawn('ffmpeg', [
      '-f', 'concat',
      '-safe', '0',
      '-i', listFile,
      '-c', 'copy',
      outputPath,
    ]);

    ffmpeg.on('close', (code: number | null) => {
      if (code === 0) {
        console.log('视频拼接成功');
        resolve();
      } else {
        reject(new Error(`FFmpeg 退出码: ${code}`));
      }
    });

    ffmpeg.on('error', (err: Error) => {
      reject(err);
    });
  });
}
