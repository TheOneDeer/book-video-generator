import { NextRequest } from 'next/server';
import { LLMClient, Config, ImageGenerationClient, TTSClient } from 'coze-coding-dev-sdk';
import { VideoGenerationClient } from 'coze-coding-dev-sdk';
import fs from 'fs';
import path from 'path';
import { writeFile } from 'fs/promises';

interface ProgressEvent {
  type: 'progress' | 'outline' | 'script' | 'image' | 'video_segment' | 'video_final' | 'error' | 'complete';
  step: string;
  message: string;
  data?: any;
  progress: number;
}

// 下载文件到本地
async function downloadFileToLocal(url: string, localPath: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`下载失败: ${response.status}`);
  }
  
  const buffer = await response.arrayBuffer();
  await writeFile(localPath, Buffer.from(buffer));
}

export async function POST(request: NextRequest) {
  const encoder = new TextEncoder();
  let controllerClosed = false;
  
  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (event: ProgressEvent) => {
        try {
          // 检查 controller 是否已关闭
          if (controllerClosed || controller.desiredSize === null) {
            console.warn('Controller 已关闭，跳过事件发送:', event.type);
            return;
          }
          const jsonStr = JSON.stringify(event);
          const data = `data: ${jsonStr}\n\n`;
          controller.enqueue(encoder.encode(data));
        } catch (e) {
          console.error('发送事件失败:', e);
          controllerClosed = true;
        }
      };

      // 监听客户端断开连接
      const cleanup = () => {
        controllerClosed = true;
        console.log('客户端连接已断开');
      };

      request.signal.addEventListener('abort', cleanup);

      const tempDir = path.join('/tmp', `video-gen-${Date.now()}`);
      fs.mkdirSync(tempDir, { recursive: true });

      try {
        const body = await request.json();
        const { bookName, generateMode = 'video', selectedVoice = 'zh_female_xiaohe_uranus_bigtts' } = body;
        const config = new Config();

        console.log(`用户选择的音色: ${selectedVoice}`);

        if (!bookName) {
          sendEvent({
            type: 'error',
            step: '初始化',
            message: '请提供书名',
            progress: 0,
          });
          controller.close();
          return;
        }

        console.log(`开始为书《${bookName}》生成${generateMode === 'video' ? '视频' : '图片+音频'}`);
        console.log(`生成模式: ${generateMode}`);

        // ========== 步骤1：生成大纲 ==========
        sendEvent({
          type: 'progress',
          step: '生成大纲',
          message: '正在分析书籍，生成内容大纲...',
          progress: 5,
        });

        const llmClient = new LLMClient(config);
        let outline = '';

        const outlineStream = llmClient.stream([
          {
            role: 'system',
            content: `你是一位资深的阅读分析师。请根据书名生成一个详细的书籍大纲。

要求：
1. 返回格式必须是纯文本，不要使用 Markdown 格式
2. 包含以下部分：
   - 书籍背景：作者、出版时间、时代背景
   - 核心主题：这本书主要讲什么
   - 关键观点：提炼3-5个最有价值的观点
   - 人物/故事：主要人物或故事线
   - 精神价值：这本书的启发和意义
3. 每个部分用【】标记，例如：【书籍背景】...
4. 内容要准确，避免错误信息`,
          },
          {
            role: 'user',
            content: `请为《${bookName}》这本书生成详细大纲。`,
          },
        ], {
          model: 'doubao-seed-1-8-251228',
          temperature: 0.7,
        });

        for await (const chunk of outlineStream) {
          if (chunk.content) {
            outline += chunk.content.toString();
          }
        }

        console.log('大纲生成完成');
        sendEvent({
          type: 'outline',
          step: '生成大纲',
          message: '大纲生成完成！',
          data: { content: outline },
          progress: 10,
        });

        // ========== 步骤2：基于大纲生成详细文案 ==========
        sendEvent({
          type: 'progress',
          step: '生成文案',
          message: '正在基于大纲创作详细文案...',
          progress: 15,
        });

        let script = '';
        let lastChunk = '';

        const scriptStream = llmClient.stream([
          {
            role: 'system',
            content: `你是一位资深的科普自媒体创作者，擅长用轻松诙谐的方式分享书籍。

撰写要求：
1. **风格定位**：用轻松诙谐的语言，结合网络热梗和生活化的例子，把复杂的知识讲得通俗易懂。语气要像和朋友聊天一样自然。
2. **开头**：用一个有趣的问题、一个反常识的观点，或者一个生活中的痛点引入，迅速抓住观众的注意力。
3. **主体**：简要介绍书籍的核心内容，提炼书中最有价值的3-5个观点或知识点，用生动的例子进行解释。分享你阅读这本书的真实感受和启发。
4. **结尾**：用一个有力的总结，或者一个开放性的问题，引导观众留言互动。
5. **字数**：500-800字之间，适合短视频时长（3-5分钟）。
6. **格式要求**：直接输出文案正文，不要使用任何括号、标题或结构标记。不要写"开头"、"主体"、"结尾"等词语。就是一段完整的、可以直接朗读的文案。
7. **情感表达**：适当使用感叹号、问号等标点符号表达情感。用口语化的表达方式，让文案有自然的语调变化，适合真人配音朗读。

参考的大纲信息：
${outline}`,
          },
          {
            role: 'user',
            content: `请直接撰写《${bookName}》的书籍分享文案，只输出正文，不要任何结构标记或括号。要有人说话的感觉，有自然的语调变化。`,
          },
        ], {
          model: 'doubao-seed-1-8-251228',
          temperature: 0.8,
        });

        let scriptProgress = 15;
        for await (const chunk of scriptStream) {
          if (chunk.content) {
            const chunkText = chunk.content.toString();
            lastChunk += chunkText;
            scriptProgress = Math.min(30, scriptProgress + 1);

            try {
              sendEvent({
                type: 'script',
                step: '生成文案',
                message: '正在创作文案...',
                data: { content: lastChunk },
                progress: scriptProgress,
              });
            } catch (e) {
              console.error('发送脚本内容失败:', e);
            }
          }
        }

        script = lastChunk.trim();
        console.log('文案生成完成，长度：', script.length);

        // 如果文案太短，补充内容
        if (script.length < 400) {
          sendEvent({
            type: 'progress',
            step: '生成文案',
            message: '文案较短，正在补充内容...',
            progress: 32,
          });

          const supplementResponse = await llmClient.invoke([
            {
              role: 'system',
              content: '你是一位擅长扩充内容的文案编辑。请保持原文的风格、语气和结构，增加细节和例子，使内容更丰富。',
            },
            {
              role: 'user',
              content: `这段文案有点短，请帮我扩充到500-800字，保持原来的风格和结构。原文案：${script}`,
            },
          ], {
            model: 'doubao-seed-1-8-251228',
            temperature: 0.8,
          });

          script = supplementResponse.content.trim();
        }

        sendEvent({
          type: 'script',
          step: '生成文案',
          message: `文案创作完成！共 ${script.length} 字`,
          data: { content: script, completed: true },
          progress: 35,
        });

        // 智能分割句子，确保每段长度适中
        const segments = smartSplitSentences(script);
        console.log('分割成片段数量：', segments.length);

        // ========== 步骤3：为每句话生成内容（视频或图片+音频） ==========
        const videoClient = new VideoGenerationClient(config);
        const imageClient = new ImageGenerationClient(config);
        const ttsClient = new TTSClient(config);
        const videoSegments: { sentence: string; videoUrl?: string; imageUrl?: string; audioUrl?: string; index: number; duration: number }[] = [];

        const totalSegments = segments.length;
        const baseProgress = 35;
        const progressPerSegment = 55 / totalSegments;

        for (let i = 0; i < totalSegments; i++) {
          const segment = segments[i];
          const segmentProgress = Math.min(90, baseProgress + Math.floor((i + 1) * progressPerSegment));

          // 根据字符数动态计算视频时长（4-8秒）
          // 假设正常语速约 4-5 字/秒
          const charsPerSecond = 4.5;
          const calculatedDuration = Math.ceil(segment.length / charsPerSecond);
          const duration = Math.max(4, Math.min(8, calculatedDuration));

          // 添加请求间隔，避免触发速率限制
          if (i > 0) {
            await new Promise(resolve => setTimeout(resolve, 3000)); // 每个片段之间等待3秒
          }

          // 根据模式选择生成方式
          if (generateMode === 'video') {
            // 视频模式：使用视频生成 API
            sendEvent({
              type: 'progress',
              step: '生成视频片段',
              message: `正在为第 ${i + 1}/${totalSegments} 段生成视频 (${duration}秒)...`,
              progress: segmentProgress,
            });

            // 使用视频生成 API 生成片段（带自动配音）
            const content = [
              {
                type: 'text' as const,
                text: segment,
              },
            ];

          let videoUrl = '';
          let videoGenSuccess = false;

          try {
            // 尝试使用动态时长
            const videoResponse = await videoClient.videoGeneration(content, {
              model: 'doubao-seedance-1-5-pro-251215',
              duration: duration,
              ratio: '16:9',
              resolution: '720p',
              generateAudio: true,
            });

            if (videoResponse.videoUrl) {
              videoUrl = videoResponse.videoUrl;
              videoGenSuccess = true;
              
              // 保存视频片段到本地
              const localVideoPath = path.join(tempDir, `segment_${i}.mp4`);
              const videoBuffer = await fetch(videoResponse.videoUrl).then(res => res.arrayBuffer());
              fs.writeFileSync(localVideoPath, Buffer.from(videoBuffer));
            }
          } catch (e) {
            const error = e as any;
            console.error(`第 ${i + 1} 段视频生成失败:`, {
              message: error.message,
              statusCode: error.statusCode,
              statusText: error.statusText,
              errorCode: error.response?.error?.code,
            });
            
            // 403错误处理
            if (error.statusCode === 403) {
              const errorCode = error.response?.error?.code;
              
              if (errorCode === 'ErrTooManyRequests') {
                sendEvent({
                  type: 'error',
                  step: '生成视频',
                  message: `请求频率超限，请等待5-10分钟后重试。当前API限制了短时间内请求次数。`,
                  data: { segmentIndex: i, error: 'RATE_LIMIT_EXCEEDED' },
                  progress: segmentProgress,
                });
                return;
              } else {
                sendEvent({
                  type: 'error',
                  step: '生成视频',
                  message: `视频生成API权限被拒绝(403)，错误代码: ${errorCode}。请检查集成服务配置或稍后重试`,
                  data: { segmentIndex: i, error: 'API_PERMISSION_DENIED', errorCode },
                  progress: segmentProgress,
                });
                return;
              }
            }
            
            console.error(`第 ${i + 1} 段视频生成失败，尝试降级到图像+音频:`, e);
            videoGenSuccess = false;
          }

          if (videoGenSuccess) {
            // 视频生成成功
            videoSegments.push({
              sentence: segment,
              videoUrl,
              index: i,
              duration,
            });

            // 发送视频片段事件
            sendEvent({
              type: 'video_segment',
              step: '生成视频片段',
              message: `第 ${i + 1}/${totalSegments} 段视频片段生成完成 (${duration}秒)`,
              data: {
                index: i,
                total: totalSegments,
                sentence: segment,
                videoUrl,
                duration,
              },
              progress: segmentProgress + 2,
            });
          } else {
            // 视频生成失败，使用降级方案：图片+音频
            sendEvent({
              type: 'progress',
              step: '生成图片+音频',
              message: `视频生成失败，正在为第 ${i + 1}/${totalSegments} 段生成图片和音频...`,
              progress: segmentProgress,
            });

            // 生成图片
            let imageUrl = '';
            try {
              const imageResponse = await imageClient.generate({
                prompt: `${segment.substring(0, 50)}... 适合书籍讲解的插画风格`,
                size: '1024x1024',
              });
              if (imageResponse.data && imageResponse.data[0] && imageResponse.data[0].url) {
                // 下载图片到本地
                const remoteUrl = imageResponse.data[0].url;
                const localImagePath = path.join(tempDir, `image_${i}.jpg`);
                await downloadFileToLocal(remoteUrl, localImagePath);
                // 返回通过API访问的URL，而不是本地路径
                imageUrl = `/api/temp-file?path=${encodeURIComponent(localImagePath)}`;
              }
            } catch (e) {
              const error = e as any;
              console.error('图片生成失败:', {
                message: error.message,
                statusCode: error.statusCode,
                errorCode: error.response?.error?.code,
              });
              
              // 403错误处理
              if (error.statusCode === 403) {
                const errorCode = error.response?.error?.code;
                
                if (errorCode === 'ErrTooManyRequests') {
                  sendEvent({
                    type: 'error',
                    step: '生成图片',
                    message: `请求频率超限，请等待5-10分钟后重试。当前API限制了短时间内请求次数。`,
                    data: { segmentIndex: i, error: 'RATE_LIMIT_EXCEEDED' },
                    progress: segmentProgress,
                  });
                  return;
                } else {
                  sendEvent({
                    type: 'error',
                    step: '生成图片',
                    message: `图片生成API权限被拒绝(403)，错误代码: ${errorCode}。请检查集成服务配置或稍后重试`,
                    data: { segmentIndex: i, error: 'API_PERMISSION_DENIED', errorCode },
                    progress: segmentProgress,
                  });
                  return;
                }
              }
              
              // 不使用占位符，图片生成失败则跳过
            }

            // 生成音频
            let audioUrl = '';
            let actualDuration = duration; // 默认使用预计算的时长
            try {
              const audioResponse = await ttsClient.synthesize({
                uid: `segment_${i}_${Date.now()}`,
                text: segment,
                speaker: selectedVoice,
                audioFormat: 'mp3',
                sampleRate: 24000,
                speechRate: 10,
                loudnessRate: 5,
              });
              if (audioResponse.audioUri) {
                // 下载音频到本地
                const remoteUrl = audioResponse.audioUri;
                const localAudioPath = path.join(tempDir, `audio_${i}.mp3`);
                await downloadFileToLocal(remoteUrl, localAudioPath);
                // 返回通过API访问的URL，而不是本地路径
                audioUrl = `/api/temp-file?path=${encodeURIComponent(localAudioPath)}`;

                // 使用音频文件大小计算实际时长
                // 假设MP3 24kHz 128kbps，时长 = 文件大小(字节) / 16000
                if (audioResponse.audioSize && audioResponse.audioSize > 0) {
                  const estimatedDuration = audioResponse.audioSize / 16000;
                  // 确保时长合理（2-15秒之间）
                  actualDuration = Math.max(2, Math.min(15, estimatedDuration));
                  console.log(`片段 ${i}: 文字长度=${segment.length}字, 预估时长=${duration}s, 音频大小=${audioResponse.audioSize}字节, 实际时长=${actualDuration}s`);
                }
              }
            } catch (e) {
              console.error('音频生成失败:', e);
            }

            videoSegments.push({
              sentence: segment,
              imageUrl,
              audioUrl,
              index: i,
              duration: actualDuration,
            });

            // 发送图片+音频片段事件
            sendEvent({
              type: 'image',
              step: '生成图片+音频',
              message: `第 ${i + 1}/${totalSegments} 段内容生成完成（降级模式）`,
              data: {
                index: i,
                total: totalSegments,
                sentence: segment,
                imageUrl,
                audioUrl,
                duration: actualDuration,
              },
              progress: segmentProgress + 2,
            });
          }
          } else {
            // 图片+音频模式：直接生成图片和音频，不尝试视频生成
            sendEvent({
              type: 'progress',
              step: '生成图片+音频',
              message: `正在为第 ${i + 1}/${totalSegments} 段生成图片和音频...`,
              progress: segmentProgress,
            });

            // 生成图片
            let imageUrl = '';
            try {
              const imageResponse = await imageClient.generate({
                prompt: `${segment.substring(0, 50)}... 适合书籍讲解的插画风格`,
                size: '1024x1024',
              });
              if (imageResponse.data && imageResponse.data[0] && imageResponse.data[0].url) {
                // 下载图片到本地
                const remoteUrl = imageResponse.data[0].url;
                const localImagePath = path.join(tempDir, `image_${i}.jpg`);
                await downloadFileToLocal(remoteUrl, localImagePath);
                // 返回通过API访问的URL，而不是本地路径
                imageUrl = `/api/temp-file?path=${encodeURIComponent(localImagePath)}`;
              }
            } catch (e) {
              const error = e as any;
              console.error('图片生成失败:', {
                message: error.message,
                statusCode: error.statusCode,
                errorCode: error.response?.error?.code,
              });
              
              // 403错误处理
              if (error.statusCode === 403) {
                const errorCode = error.response?.error?.code;
                
                if (errorCode === 'ErrTooManyRequests') {
                  sendEvent({
                    type: 'error',
                    step: '生成图片',
                    message: `请求频率超限，请等待5-10分钟后重试。当前API限制了短时间内请求次数。`,
                    data: { segmentIndex: i, error: 'RATE_LIMIT_EXCEEDED' },
                    progress: segmentProgress,
                  });
                  return;
                } else {
                  sendEvent({
                    type: 'error',
                    step: '生成图片',
                    message: `图片生成API权限被拒绝(403)，错误代码: ${errorCode}。请检查集成服务配置或稍后重试`,
                    data: { segmentIndex: i, error: 'API_PERMISSION_DENIED', errorCode },
                    progress: segmentProgress,
                  });
                  return;
                }
              }
              
              // 不使用占位符，图片生成失败则跳过
            }

            // 生成音频
            let audioUrl = '';
            let actualDuration = duration; // 默认使用预计算的时长
            try {
              const audioResponse = await ttsClient.synthesize({
                uid: `segment_${i}_${Date.now()}`,
                text: segment,
                speaker: selectedVoice,
                audioFormat: 'mp3',
                sampleRate: 24000,
                speechRate: 10,
                loudnessRate: 5,
              });
              if (audioResponse.audioUri) {
                // 下载音频到本地
                const remoteUrl = audioResponse.audioUri;
                const localAudioPath = path.join(tempDir, `audio_${i}.mp3`);
                await downloadFileToLocal(remoteUrl, localAudioPath);
                // 返回通过API访问的URL，而不是本地路径
                audioUrl = `/api/temp-file?path=${encodeURIComponent(localAudioPath)}`;

                // 使用音频文件大小计算实际时长
                // 假设MP3 24kHz 128kbps，时长 = 文件大小(字节) / 16000
                if (audioResponse.audioSize && audioResponse.audioSize > 0) {
                  const estimatedDuration = audioResponse.audioSize / 16000;
                  // 确保时长合理（2-15秒之间）
                  actualDuration = Math.max(2, Math.min(15, estimatedDuration));
                  console.log(`片段 ${i}: 文字长度=${segment.length}字, 预估时长=${duration}s, 音频大小=${audioResponse.audioSize}字节, 实际时长=${actualDuration}s`);
                }
              }
            } catch (e) {
              console.error('音频生成失败:', e);
            }

            videoSegments.push({
              sentence: segment,
              imageUrl,
              audioUrl,
              index: i,
              duration: actualDuration,
            });

            // 发送图片+音频片段事件
            sendEvent({
              type: 'image',
              step: '生成图片+音频',
              message: `第 ${i + 1}/${totalSegments} 段内容生成完成`,
              data: {
                index: i,
                total: totalSegments,
                sentence: segment,
                imageUrl,
                audioUrl,
                duration: actualDuration,
              },
              progress: segmentProgress + 2,
            });
          }
        }

        // ========== 步骤4：拼接视频或返回内容 ==========
        sendEvent({
          type: 'progress',
          step: '拼接视频',
          message: '正在整理生成的内容...',
          progress: 92,
        });

        // 检查是否有成功的视频片段
        const hasVideoSegments = videoSegments.some(s => s.videoUrl);
        const hasFallbackSegments = videoSegments.some(s => s.imageUrl);
        
        let finalVideoUrl = '';
        let fallbackMode = hasFallbackSegments && !hasVideoSegments;

        if (hasVideoSegments) {
          // 有视频片段，尝试拼接
          const videoPaths = videoSegments
            .filter(s => s.videoUrl)
            .map(s => path.join(tempDir, `segment_${s.index}.mp4`));

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

          if (ffmpegAvailable && videoPaths.length > 1) {
            // 使用 FFmpeg 拼接
            console.log('使用 FFmpeg 拼接视频');
            const outputPath = path.join(tempDir, 'final_video.mp4');
            await concatVideos(videoPaths, outputPath);
            
            const videoBuffer = fs.readFileSync(outputPath);
            finalVideoUrl = `data:video/mp4;base64,${videoBuffer.toString('base64')}`;
          } else if (videoPaths.length === 1) {
            // 只有一个视频片段，直接使用
            console.log('只有一个视频片段，直接使用');
            finalVideoUrl = videoSegments.find(s => s.videoUrl)?.videoUrl || '';
          } else if (videoPaths.length > 1) {
            // 有多个视频片段但FFmpeg不可用，不设置finalVideoUrl，让用户手动拼接
            console.log(`有 ${videoPaths.length} 个视频片段但FFmpeg不可用，等待用户手动拼接`);
            finalVideoUrl = '';
            
            sendEvent({
              type: 'progress',
              step: '准备拼接',
              message: `已生成 ${videoPaths.length} 个视频片段，可在"完整视频"标签页手动拼接`,
              progress: 95,
            });
          } else {
            // 没有可用的视频片段
            console.log('没有可用的视频片段');
            finalVideoUrl = '';
          }
        }

        if (hasFallbackSegments && !hasVideoSegments) {
          // 所有片段都降级到了图片+音频模式
          sendEvent({
            type: 'progress',
            step: '准备内容',
            message: '已生成图片和音频，将展示幻灯片模式',
            progress: 95,
          });
        }

        console.log('内容生成完成！');

        // 保存临时目录路径，以便后续拼接视频使用
        // 不立即清理，等待用户点击拼接按钮后再清理
        const tempDirForConcat = tempDir;

        sendEvent({
          type: 'video_final',
          step: '完成',
          message: fallbackMode ? '内容已生成（幻灯片模式）！' : (hasVideoSegments ? `所有 ${videoSegments.length} 个视频片段已生成！` : '内容生成完成！'),
          data: {
            videoUrl: fallbackMode ? undefined : finalVideoUrl,
            script,
            outline,
            segments: videoSegments.map(s => ({ 
              index: s.index, 
              sentence: s.sentence, 
              duration: s.duration,
              imageUrl: s.imageUrl,
              audioUrl: s.audioUrl,
              videoUrl: s.videoUrl,
            })),
            fallbackMode,
            ffmpegAvailable: hasVideoSegments,
            hasVideoSegments,
            hasFallbackSegments,
            tempDir: tempDirForConcat,
            canConcat: hasVideoSegments && videoSegments.length > 1,
          },
          progress: 100,
        });

        sendEvent({
          type: 'complete',
          step: '完成',
          message: '所有步骤已完成！',
          progress: 100,
        });

      } catch (error) {
        console.error('生成视频时出错：', error);

        // 清理临时文件
        try {
          fs.rmSync(tempDir, { recursive: true, force: true });
        } catch (e) {
          console.error('清理临时文件失败：', e);
        }

        sendEvent({
          type: 'error',
          step: '错误',
          message: error instanceof Error ? error.message : '生成视频失败',
          progress: 0,
        });
      } finally {
        request.signal.removeEventListener('abort', cleanup);
        controllerClosed = true;
        if (!controller.desiredSize) {
          try {
            controller.close();
          } catch (e) {
            console.error('关闭 controller 失败:', e);
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

// 智能分割句子，确保每段长度适中
function smartSplitSentences(text: string): string[] {
  const segments: string[] = [];

  // 先按句号、感叹号、问号分割
  const sentences = text.split(/([。！？.!?])/).reduce((acc: string[], part: string, index: number, array: string[]) => {
    if (index % 2 === 0) {
      // 文本部分
      acc.push(part);
    } else {
      // 标点部分
      acc[acc.length - 1] += part;
    }
    return acc;
  }, []);

  // 对每个句子进行进一步分割
  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;

    // 如果句子长度小于等于 30 字，直接作为一个片段
    if (trimmed.length <= 30) {
      segments.push(trimmed);
      continue;
    }

    // 句子过长，需要进一步分割
    // 尝试按逗号、顿号、分号分割
    const subSegments = trimmed.split(/([，,、;；])/).reduce((acc: string[], part: string, index: number, array: string[]) => {
      if (index % 2 === 0) {
        acc.push(part);
      } else {
        acc[acc.length - 1] += part;
      }
      return acc;
    }, []);

    // 合并过短的片段（小于10字）
    let currentText = '';
    for (const sub of subSegments) {
      const trimmedSub = sub.trim();
      if (!trimmedSub) continue;

      // 如果当前片段加上新片段不超过 30 字，合并
      if (currentText.length + trimmedSub.length <= 30) {
        currentText += trimmedSub;
      } else {
        // 保存当前片段，开始新片段
        if (currentText) {
          segments.push(currentText);
        }
        currentText = trimmedSub;

        // 如果单个片段还是太长（> 40字），强制按字符切分
        if (currentText.length > 40) {
          const chars = currentText.split('');
          let chunk = '';
          for (const char of chars) {
            chunk += char;
            if (chunk.length >= 30) {
              segments.push(chunk);
              chunk = '';
            }
          }
          if (chunk) {
            currentText = chunk;
          }
        }
      }
    }
    if (currentText) {
      segments.push(currentText);
    }
  }

  return segments;
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
