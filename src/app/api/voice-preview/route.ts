import { NextRequest, NextResponse } from 'next/server';
import { TTSClient, Config } from 'coze-coding-dev-sdk';
import axios from 'axios';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { voiceId, text } = body;

    if (!voiceId || !text) {
      return NextResponse.json(
        { error: 'voiceId and text are required' },
        { status: 400 }
      );
    }

    // 初始化TTS客户端
    const config = new Config();
    const client = new TTSClient(config);

    // 调用TTS API生成音频
    const response = await client.synthesize({
      uid: 'preview-' + Date.now(),
      text,
      speaker: voiceId,
      audioFormat: 'mp3',
      sampleRate: 24000,
      speechRate: 0,
      loudnessRate: 0,
    });

    // 下载音频数据
    const audioResponse = await axios.get(response.audioUri, {
      responseType: 'arraybuffer',
      timeout: 30000,
    });

    // 返回音频文件
    return new NextResponse(audioResponse.data, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': audioResponse.data.byteLength.toString(),
        'Cache-Control': 'public, max-age=86400', // 缓存24小时
      },
    });
  } catch (error) {
    console.error('Voice preview error:', error);
    return NextResponse.json(
      { error: 'Failed to generate voice preview' },
      { status: 500 }
    );
  }
}
