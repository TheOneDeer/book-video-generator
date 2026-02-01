import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

interface FileMatch {
  index: number;
  imagePath: string;
  imageApiUrl: string;
  audioPath: string;
  audioApiUrl: string;
  duration: number;
}

/**
 * API端点：扫描本地目录，匹配图片和音频文件
 * 用于拼接已生成的图片+音频片段
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const dirPath = searchParams.get('path');

    if (!dirPath) {
      return NextResponse.json({ error: '缺少目录路径参数' }, { status: 400 });
    }

    // 安全检查：只允许访问 /tmp 目录
    const normalizedPath = path.normalize(dirPath);
    if (!normalizedPath.startsWith('/tmp/')) {
      return NextResponse.json({ error: '只允许访问 /tmp 目录' }, { status: 403 });
    }

    // 检查目录是否存在
    if (!fs.existsSync(normalizedPath)) {
      return NextResponse.json({ error: '目录不存在' }, { status: 404 });
    }

    if (!fs.statSync(normalizedPath).isDirectory()) {
      return NextResponse.json({ error: '路径不是目录' }, { status: 400 });
    }

    // 读取目录下的所有文件
    const files = fs.readdirSync(normalizedPath);
    
    // 提取图片文件 (image_x.jpg 或 image_x.png)
    const imageFiles: { index: number; path: string }[] = [];
    // 提取音频文件 (audio_x.mp3)
    const audioFiles: { index: number; path: string }[] = [];

    files.forEach(file => {
      const filePath = path.join(normalizedPath, file);
      const ext = path.extname(file).toLowerCase();
      const baseName = path.basename(file, ext);

      // 匹配 image_x.jpg 格式
      const imageMatch = baseName.match(/^image_(\d+)$/);
      if (imageMatch && (ext === '.jpg' || ext === '.jpeg' || ext === '.png')) {
        imageFiles.push({
          index: parseInt(imageMatch[1], 10),
          path: filePath,
        });
      }

      // 匹配 audio_x.mp3 格式
      const audioMatch = baseName.match(/^audio_(\d+)$/);
      if (audioMatch && ext === '.mp3') {
        audioFiles.push({
          index: parseInt(audioMatch[1], 10),
          path: filePath,
        });
      }
    });

    // 按索引排序
    imageFiles.sort((a, b) => a.index - b.index);
    audioFiles.sort((a, b) => a.index - b.index);

    // 匹配图片和音频
    const matches: FileMatch[] = [];
    const matchedImageIndices = new Set<number>();
    const matchedAudioIndices = new Set<number>();

    // 优先匹配有图片和音频的片段
    imageFiles.forEach(img => {
      const audio = audioFiles.find(a => a.index === img.index);
      if (audio) {
        matches.push({
          index: img.index,
          imagePath: img.path,
          imageApiUrl: `/api/temp-file?path=${encodeURIComponent(img.path)}`,
          audioPath: audio.path,
          audioApiUrl: `/api/temp-file?path=${encodeURIComponent(audio.path)}`,
          // 默认时长，可以后续从音频文件中读取
          duration: 5,
        });
        matchedImageIndices.add(img.index);
        matchedAudioIndices.add(audio.index);
      }
    });

    // 添加只有图片的片段
    imageFiles.forEach(img => {
      if (!matchedImageIndices.has(img.index)) {
        matches.push({
          index: img.index,
          imagePath: img.path,
          imageApiUrl: `/api/temp-file?path=${encodeURIComponent(img.path)}`,
          audioPath: '',
          audioApiUrl: '',
          duration: 5,
        });
      }
    });

    // 添加只有音频的片段
    audioFiles.forEach(audio => {
      if (!matchedAudioIndices.has(audio.index)) {
        matches.push({
          index: audio.index,
          imagePath: '',
          imageApiUrl: '',
          audioPath: audio.path,
          audioApiUrl: `/api/temp-file?path=${encodeURIComponent(audio.path)}`,
          duration: 5,
        });
      }
    });

    // 按索引排序最终结果
    matches.sort((a, b) => a.index - b.index);

    return NextResponse.json({
      dirPath: normalizedPath,
      totalFiles: files.length,
      imageCount: imageFiles.length,
      audioCount: audioFiles.length,
      matches: matches,
      canConcat: matches.length > 0,
    });
  } catch (error) {
    console.error('扫描目录失败:', error);
    return NextResponse.json({ error: '扫描目录失败' }, { status: 500 });
  }
}
