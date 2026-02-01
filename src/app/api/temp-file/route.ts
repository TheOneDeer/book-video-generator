import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

/**
 * API端点：提供临时文件的访问
 * 用于访问存储在 /tmp 目录下的生成文件（图片、音频、视频）
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const filePath = searchParams.get('path');

    if (!filePath) {
      return NextResponse.json({ error: '缺少文件路径参数' }, { status: 400 });
    }

    // 安全检查：只允许访问 /tmp 目录下的文件
    const normalizedPath = path.normalize(filePath);
    if (!normalizedPath.startsWith('/tmp/')) {
      return NextResponse.json({ error: '只允许访问 /tmp 目录下的文件' }, { status: 403 });
    }

    // 检查文件是否存在
    if (!fs.existsSync(normalizedPath)) {
      return NextResponse.json({ error: '文件不存在' }, { status: 404 });
    }

    // 获取文件扩展名
    const ext = path.extname(normalizedPath).toLowerCase();
    
    // 根据文件类型设置正确的Content-Type
    let contentType = 'application/octet-stream';
    if (ext === '.jpg' || ext === '.jpeg') {
      contentType = 'image/jpeg';
    } else if (ext === '.png') {
      contentType = 'image/png';
    } else if (ext === '.mp3') {
      contentType = 'audio/mpeg';
    } else if (ext === '.mp4') {
      contentType = 'video/mp4';
    } else if (ext === '.webm') {
      contentType = 'video/webm';
    }

    // 读取文件并返回
    const fileBuffer = fs.readFileSync(normalizedPath);
    
    return new NextResponse(fileBuffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600', // 缓存1小时
      },
    });
  } catch (error) {
    console.error('读取临时文件失败:', error);
    return NextResponse.json({ error: '读取文件失败' }, { status: 500 });
  }
}
