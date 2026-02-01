'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Play, Sparkles, Download, FileText, Image, Video, Loader2, CheckCircle2, AlertCircle, PlayCircle, Scissors, Search, Film, Music, Volume2, VolumeX } from 'lucide-react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface ProgressData {
  type: 'progress' | 'outline' | 'script' | 'image' | 'video_segment' | 'video_final' | 'error' | 'complete';
  step: string;
  message: string;
  data?: any;
  progress: number;
}

interface VideoSegment {
  index: number;
  total: number;
  sentence: string;
  videoUrl?: string;
  imageUrl?: string;
  audioUrl?: string;
  duration: number;
}

interface VoiceOption {
  id: string;
  name: string;
  category: string;
  description: string;
}

const voiceOptions: VoiceOption[] = [
  { id: 'zh_female_xiaohe_uranus_bigtts', name: '小和', category: '通用', description: '默认音色，适合通用场景' },
  { id: 'zh_female_vv_uranus_bigtts', name: 'Vivi', category: '通用', description: '中英双语' },
  { id: 'zh_male_m191_uranus_bigtts', name: '云洲', category: '通用', description: '男声，稳重' },
  { id: 'zh_male_taocheng_uranus_bigtts', name: '小天', category: '通用', description: '男声，活泼' },
  { id: 'zh_female_xueayi_saturn_bigtts', name: '学艺', category: '有声书', description: '儿童有声书' },
  { id: 'zh_male_dayi_saturn_bigtts', name: '大一', category: '视频配音', description: '男声，适合视频讲解' },
  { id: 'zh_female_mizai_saturn_bigtts', name: '米仔', category: '视频配音', description: '女声，甜美' },
  { id: 'zh_female_jitangnv_saturn_bigtts', name: '鸡汤女', category: '视频配音', description: '激励风格' },
  { id: 'zh_female_meilinvyou_saturn_bigtts', name: '美丽女友', category: '视频配音', description: '温柔女友音' },
  { id: 'zh_female_santongyongns_saturn_bigtts', name: '三通用女声', category: '视频配音', description: '自然流畅' },
  { id: 'zh_male_ruyayichen_saturn_bigtts', name: '雅逸一尘', category: '视频配音', description: '优雅男声' },
  { id: 'saturn_zh_female_keainvsheng_tob', name: '可爱女生', category: '角色扮演', description: '可爱活泼' },
  { id: 'saturn_zh_female_tiaopigongzhu_tob', name: '调皮公主', category: '角色扮演', description: '俏皮风格' },
  { id: 'saturn_zh_male_shuanglangshaonian_tob', name: '爽朗少年', category: '角色扮演', description: '阳光少年' },
  { id: 'saturn_zh_male_tiancaitongzhuo_tob', name: '天才同桌', category: '角色扮演', description: '学霸风格' },
  { id: 'saturn_zh_female_cancan_tob', name: '聪聪', category: '角色扮演', description: '聪明伶俐' },
];

const voiceCategories = Array.from(new Set(voiceOptions.map(v => v.category)));

export default function BookVideoGenerator() {
  const [bookName, setBookName] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isConcatenating, setIsConcatenating] = useState(false);
  const [isConcatImageAudio, setIsConcatImageAudio] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentStep, setCurrentStep] = useState('');
  const [outline, setOutline] = useState('');
  const [script, setScript] = useState('');
  const [finalVideoUrl, setFinalVideoUrl] = useState('');
  const [videoSegments, setVideoSegments] = useState<VideoSegment[]>([]);
  const [error, setError] = useState('');
  const [ffmpegAvailable, setFfmpegAvailable] = useState(true);
  const [fallbackMode, setFallbackMode] = useState(false);
  const [tempDir, setTempDir] = useState('');
  const [canConcat, setCanConcat] = useState(false);
  const [canConcatImageAudio, setCanConcatImageAudio] = useState(false);
  const [generateMode, setGenerateMode] = useState<'video' | 'image'>('video');
  const [localDirPath, setLocalDirPath] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [localMatches, setLocalMatches] = useState<VideoSegment[]>([]);
  const [ffmpegLoaded, setFfmpegLoaded] = useState(false);
  const [browserVideoUrl, setBrowserVideoUrl] = useState('');
  const [selectedVoice, setSelectedVoice] = useState('zh_female_xiaohe_uranus_bigtts');
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const [voicePreviewCache, setVoicePreviewCache] = useState<Record<string, string>>({});
  const [previewLoading, setPreviewLoading] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  const ffmpegRef = useRef<FFmpeg | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const concatAbortControllerRef = useRef<AbortController | null>(null);
  const concatImageAudioAbortRef = useRef<AbortController | null>(null);

  // 播放音色预览
  const handlePlayVoicePreview = async (voiceId: string, voiceName: string) => {
    // 如果正在播放，停止播放
    if (playingVoiceId === voiceId) {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }
      setPlayingVoiceId(null);
      return;
    }

    // 停止当前播放
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }

    // 检查缓存
    if (voicePreviewCache[voiceId]) {
      setPlayingVoiceId(voiceId);
      audioRef.current = new Audio(voicePreviewCache[voiceId]);
      audioRef.current.onended = () => setPlayingVoiceId(null);
      audioRef.current.onerror = () => {
        setPlayingVoiceId(null);
        setError('音频播放失败');
      };
      await audioRef.current.play();
      return;
    }

    // 生成新音频
    setPreviewLoading(true);
    try {
      const response = await fetch('/api/voice-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voiceId, text: `你好，我是${voiceName}，很高兴为您配音。` }),
      });

      if (!response.ok) {
        throw new Error('生成预览音频失败');
      }

      const blob = await response.blob();
      const audioUrl = URL.createObjectURL(blob);

      // 缓存音频
      setVoicePreviewCache(prev => ({ ...prev, [voiceId]: audioUrl }));

      // 播放音频
      setPlayingVoiceId(voiceId);
      audioRef.current = new Audio(audioUrl);
      audioRef.current.onended = () => setPlayingVoiceId(null);
      audioRef.current.onerror = () => {
        setPlayingVoiceId(null);
        setError('音频播放失败');
      };
      await audioRef.current.play();
    } catch (err) {
      setError('生成预览音频失败，请稍后重试');
      console.error('Voice preview error:', err);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleGenerate = async () => {
    if (!bookName.trim()) {
      setError('请输入书名');
      return;
    }

    setError('');
    setIsGenerating(true);
    setProgress(0);
    setCurrentStep('初始化');
    setOutline('');
    setScript('');
    setFinalVideoUrl('');
    setVideoSegments([]);
    setFallbackMode(false);
    setFfmpegAvailable(true);

    abortControllerRef.current = new AbortController();

    // 设置超时时间（30分钟）
    const timeoutMs = 30 * 60 * 1000; // 30分钟
    let timeoutId: NodeJS.Timeout | undefined;

    try {
      // 设置超时定时器
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          abortControllerRef.current?.abort();
          reject(new Error('请求超时，生成时间过长。请稍后重试或减少生成内容。'));
        }, timeoutMs);
      });

      // 发起fetch请求
      const fetchPromise = fetch('/api/generate-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookName, generateMode, selectedVoice }),
        signal: abortControllerRef.current.signal,
      });

      // 使用Promise.race处理超时
      const response = await Promise.race([fetchPromise, timeoutPromise]);

      // 清除超时定时器
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      if (!response.ok) {
        throw new Error('请求失败');
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error('无法读取响应流');
      }

      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const jsonStr = line.slice(6);
              const data = JSON.parse(jsonStr) as ProgressData;

              setProgress(data.progress);
              setCurrentStep(data.step);

              switch (data.type) {
                case 'progress':
                  break;
                case 'outline':
                  setOutline(data.data?.content || '');
                  break;
                case 'script':
                  setScript(data.data?.content || script);
                  break;
                case 'image':
                case 'video_segment':
                  setVideoSegments((prev) => {
                    const newSegments = [...prev];
                    const existingIndex = newSegments.findIndex(
                      (s) => s.index === data.data?.index
                    );
                    const segment = {
                      index: data.data?.index,
                      total: data.data?.total,
                      sentence: data.data?.sentence,
                      videoUrl: data.data?.videoUrl,
                      imageUrl: data.data?.imageUrl,
                      audioUrl: data.data?.audioUrl,
                      duration: data.data?.duration || 4,
                    };
                    if (existingIndex >= 0) {
                      newSegments[existingIndex] = segment;
                    } else {
                      newSegments.push(segment);
                    }
                    return newSegments;
                  });
                  break;
                case 'video_final':
                  setFinalVideoUrl(data.data?.videoUrl || '');
                  setFfmpegAvailable(data.data?.ffmpegAvailable ?? true);
                  setFallbackMode(data.data?.fallbackMode ?? false);
                  setTempDir(data.data?.tempDir || '');
                  setCanConcat(data.data?.canConcat ?? false);
                  // 检查是否有图片+音频片段
                  // 本地文件模式：检查路径是否存在
                  // 远程文件模式：检查URL格式
                  setCanConcatImageAudio(
                    (data.data?.segments || []).some((s: any) => 
                      s.imageUrl && s.audioUrl && (
                        (s.imageUrl.startsWith('http') && s.audioUrl.startsWith('http')) ||
                        (s.imageUrl.startsWith('/') && s.audioUrl.startsWith('/'))
                      )
                    ) &&
                    !data.data?.videoUrl
                  );
                  break;
                case 'error':
                  setError(data.message);
                  setIsGenerating(false);
                  break;
                case 'complete':
                  setIsGenerating(false);
                  break;
              }
            } catch (e) {
              console.error('解析 JSON 失败:', e);
              continue;
            }
          }
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        console.error('生成视频失败:', err);
        const errorMessage = err.message;
        
        // 判断是否为网络错误
        if (errorMessage.includes('network') || errorMessage.includes('fetch') || errorMessage.includes('Failed to fetch')) {
          setError('网络连接中断，请检查网络后重试。已生成的内容可能不完整，建议重新生成。');
        } else if (errorMessage.includes('timeout')) {
          setError('请求超时，请稍后重试');
        } else if (errorMessage.includes('请求频率超限') || errorMessage.includes('RATE_LIMIT_EXCEEDED')) {
          setError('请求频率超限！\n\n当前API限制了短时间内请求次数。建议：\n1. 等待5-10分钟后重试\n2. 减少同时生成的片段数量\n3. 分批次生成视频');
        } else if (errorMessage.includes('403') || errorMessage.includes('权限被拒绝') || errorMessage.includes('API_PERMISSION_DENIED')) {
          setError('API权限被拒绝，可能原因：\n1. 集成服务未配置或配置错误\n2. 账号权限不足\n\n请检查集成服务配置或联系管理员。');
        } else {
          setError(errorMessage);
        }
        setIsGenerating(false);
      }
    } finally {
      abortControllerRef.current = null;
      // 清除超时定时器
      if (typeof timeoutId !== 'undefined') {
        clearTimeout(timeoutId);
      }
    }
  };

  const handleCancel = () => {
    abortControllerRef.current?.abort();
    concatAbortControllerRef.current?.abort();
    concatImageAudioAbortRef.current?.abort();
    setIsGenerating(false);
    setIsConcatenating(false);
    setIsConcatImageAudio(false);
  };

  const downloadVideo = () => {
    if (!finalVideoUrl) return;

    const link = document.createElement('a');
    link.href = finalVideoUrl;
    link.download = `${bookName}-讲解视频.mp4`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleConcatVideo = async () => {
    if (!tempDir || videoSegments.length === 0) {
      setError('缺少必要信息，无法拼接视频');
      return;
    }

    setIsConcatenating(true);
    setProgress(0);
    setCurrentStep('拼接视频');
    setError('');

    concatAbortControllerRef.current = new AbortController();

    try {
      const response = await fetch('/api/concat-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          tempDir,
          segments: videoSegments 
        }),
        signal: concatAbortControllerRef.current.signal,
      });

      if (!response.ok) {
        throw new Error('请求失败');
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error('无法读取响应流');
      }

      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const jsonStr = line.slice(6);
              const data = JSON.parse(jsonStr);

              setProgress(data.progress);
              setCurrentStep(data.step);

              switch (data.type) {
                case 'progress':
                  break;
                case 'complete':
                  setFinalVideoUrl(data.data?.videoUrl || '');
                  setIsConcatenating(false);
                  break;
                case 'error':
                  setError(data.message);
                  setIsConcatenating(false);
                  break;
              }
            } catch (e) {
              console.error('解析 JSON 失败:', e);
              continue;
            }
          }
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        console.error('拼接视频失败:', err);
        const errorMessage = err.message;
        
        // 判断是否为网络错误
        if (errorMessage.includes('network') || errorMessage.includes('fetch') || errorMessage.includes('Failed to fetch')) {
          setError('网络连接中断，请检查网络后重试拼接');
        } else if (errorMessage.includes('timeout')) {
          setError('拼接超时，请稍后重试');
        } else {
          setError(errorMessage);
        }
        setIsConcatenating(false);
      }
    } finally {
      concatAbortControllerRef.current = null;
    }
  };

  const handleConcatImageAudio = async () => {
    if (videoSegments.length === 0) {
      setError('没有可拼接的图片+音频片段');
      return;
    }

    setIsConcatImageAudio(true);
    setError('');
    concatImageAudioAbortRef.current = new AbortController();

    try {
      const response = await fetch('/api/concat-image-audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          segments: videoSegments,
          bookName,
          tempDir  // 传递临时目录路径
        }),
        signal: concatImageAudioAbortRef.current.signal,
      });

      if (!response.ok) {
        throw new Error('拼接失败');
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error('无法读取响应流');
      }

      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const jsonStr = line.slice(6);
              const data = JSON.parse(jsonStr);

              setProgress(data.progress);
              setCurrentStep(data.step);

              switch (data.type) {
                case 'progress':
                  break;
                case 'complete':
                  setFinalVideoUrl(data.data?.videoUrl || '');
                  setCanConcatImageAudio(false);
                  setIsConcatImageAudio(false);
                  break;
                case 'error':
                  setError(data.message);
                  setIsConcatImageAudio(false);
                  break;
              }
            } catch (e) {
              console.error('解析 JSON 失败:', e);
              continue;
            }
          }
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        console.error('拼接图片+音频失败:', err);
        const errorMessage = err.message;
        
        if (errorMessage.includes('network') || errorMessage.includes('fetch')) {
          setError('网络连接中断，请检查网络后重试拼接');
        } else {
          setError(errorMessage);
        }
        setIsConcatImageAudio(false);
      }
    } finally {
      concatImageAudioAbortRef.current = null;
    }
  };

  const handleScanLocalDir = async () => {
    if (!localDirPath.trim()) {
      setError('请输入本地目录路径');
      return;
    }

    setIsScanning(true);
    setError('');

    try {
      const response = await fetch(`/api/scan-directory?path=${encodeURIComponent(localDirPath.trim())}`);

      if (!response.ok) {
        throw new Error('扫描目录失败');
      }

      const data = await response.json();

      if (!data.canConcat) {
        setError('未找到匹配的图片和音频文件。请确保目录下有 image_x.jpg 和 audio_x.mp3 格式的文件。');
        setLocalMatches([]);
        return;
      }

      // 转换为VideoSegment格式
      const segments: VideoSegment[] = data.matches.map((m: any) => ({
        index: m.index,
        total: data.matches.length,
        sentence: `片段 ${m.index + 1}`,
        imageUrl: m.imageApiUrl,
        audioUrl: m.audioApiUrl,
        duration: m.duration,
      }));

      setLocalMatches(segments);
      setCurrentStep(`找到 ${segments.length} 个匹配片段`);
    } catch (err) {
      if (err instanceof Error) {
        console.error('扫描目录失败:', err);
        setError(`扫描失败: ${err.message}`);
      }
    } finally {
      setIsScanning(false);
    }
  };

  const handleConcatLocalFiles = async () => {
    if (localMatches.length === 0) {
      setError('没有可拼接的片段');
      return;
    }

    setIsConcatImageAudio(true);
    setError('');
    setProgress(0);
    setCurrentStep('拼接本地文件');

    concatImageAudioAbortRef.current = new AbortController();

    try {
      const response = await fetch('/api/concat-image-audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          segments: localMatches,
          bookName: '本地文件拼接',
          tempDir: localDirPath.trim()  // 使用用户提供的目录路径
        }),
        signal: concatImageAudioAbortRef.current.signal,
      });

      if (!response.ok) {
        throw new Error('拼接失败');
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error('无法读取响应流');
      }

      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const jsonStr = line.slice(6);
              const data = JSON.parse(jsonStr);

              setProgress(data.progress);
              setCurrentStep(data.step);

              switch (data.type) {
                case 'progress':
                  break;
                case 'complete':
                  setFinalVideoUrl(data.data?.videoUrl || '');
                  setIsConcatImageAudio(false);
                  break;
                case 'error':
                  setError(data.message);
                  setIsConcatImageAudio(false);
                  break;
              }
            } catch (e) {
              console.error('解析 JSON 失败:', e);
              continue;
            }
          }
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        console.error('拼接本地文件失败:', err);
        const errorMessage = err.message;
        
        if (errorMessage.includes('FFmpeg') || errorMessage.includes('ffmpeg') || errorMessage.includes('不可用')) {
          setError('FFmpeg不可用，无法进行视频拼接。\n\n替代方案：\n1. 您可以手动下载所有图片和音频片段\n2. 使用其他视频编辑软件（如剪映、Premiere等）拼接\n3. 联系管理员安装FFmpeg\n\n注意：所有生成的片段都保存在本地，可以继续使用。');
        } else if (errorMessage.includes('network') || errorMessage.includes('fetch')) {
          setError('网络连接中断，请检查网络后重试拼接');
        } else {
          setError(`拼接失败: ${errorMessage}`);
        }
        setIsConcatImageAudio(false);
      }
    } finally {
      concatImageAudioAbortRef.current = null;
    }
  };

  const handleDownloadAllSegments = async () => {
    if (localMatches.length === 0) {
      setError('没有可下载的片段');
      return;
    }

    setError('');
    setCurrentStep('正在打包下载所有片段...');

    try {
      // 使用JSZip打包所有文件（简化版，直接下载单个文件）
      // 这里我们只提供提示，让用户手动下载
      alert(`共有 ${localMatches.length} 个片段需要下载。\n\n您可以：\n1. 右键点击每个图片选择"图片另存为"\n2. 点击每个音频的"播放音频"按钮，然后右键选择"音频另存为"\n\n或者使用浏览器的"另存为"功能下载整个页面。`);
    } catch (err) {
      if (err instanceof Error) {
        setError(`下载失败: ${err.message}`);
      }
    }
  };

  // 加载FFmpeg到浏览器
  const loadFFmpeg = async () => {
    if (ffmpegRef.current) return ffmpegRef.current;

    setCurrentStep('正在初始化视频处理引擎...');
    setError('');

    try {
      const ffmpeg = new FFmpeg();
      ffmpegRef.current = ffmpeg;

      const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';
      
      await ffmpeg.load({
        coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
      });

      setFfmpegLoaded(true);
      setCurrentStep('视频处理引擎加载完成');
      return ffmpeg;
    } catch (err) {
      if (err instanceof Error) {
        setError(`加载视频处理引擎失败: ${err.message}`);
        throw err;
      }
      throw new Error('加载视频处理引擎失败');
    }
  };

  // 浏览器端视频拼接
  const handleConcatInBrowser = async () => {
    if (localMatches.length === 0) {
      setError('没有可拼接的片段');
      return;
    }

    setIsConcatImageAudio(true);
    setProgress(0);
    setBrowserVideoUrl('');
    setCurrentStep('准备拼接视频...');
    setError('');

    try {
      // 加载FFmpeg
      let ffmpeg = ffmpegRef.current;
      if (!ffmpeg) {
        setCurrentStep('正在加载视频处理引擎...');
        ffmpeg = await loadFFmpeg();
      }

      // 验证所有片段都有图片和音频
      const validSegments = localMatches.filter(s => s.imageUrl && s.audioUrl);
      if (validSegments.length === 0) {
        throw new Error('没有有效的片段可拼接（需要图片和音频）');
      }

      setCurrentStep(`正在下载 ${validSegments.length} 个片段...`);
      setProgress(10);

      // 下载所有图片和音频到FFmpeg虚拟文件系统
      for (let i = 0; i < validSegments.length; i++) {
        const segment = validSegments[i];
        const progress = 10 + Math.floor((i / validSegments.length) * 30);
        setProgress(progress);
        setCurrentStep(`下载片段 ${i + 1}/${validSegments.length}...`);

        try {
          // 下载图片
          if (segment.imageUrl) {
            const imageData = await fetchFile(segment.imageUrl);
            await ffmpeg.writeFile(`input_${i}.jpg`, imageData);
          }

          // 下载音频
          if (segment.audioUrl) {
            const audioData = await fetchFile(segment.audioUrl);
            await ffmpeg.writeFile(`audio_${i}.mp3`, audioData);
          }
        } catch (e) {
          console.error(`下载片段 ${i} 失败:`, e);
          throw new Error(`下载片段 ${i + 1} 失败`);
        }
      }

      setCurrentStep('正在生成视频片段...');
      setProgress(40);

      // 为每个片段创建带Ken Burns效果的视频
      const videoFiles: string[] = [];
      
      for (let i = 0; i < validSegments.length; i++) {
        const segment = validSegments[i];
        const progress = 40 + Math.floor((i / validSegments.length) * 30);
        setProgress(progress);
        setCurrentStep(`生成视频片段 ${i + 1}/${validSegments.length}...`);

        const duration = segment.duration || 5;
        const zoomFactor = 1.2;
        
        // 使用FFmpeg创建带缩放效果的视频
        await ffmpeg.exec([
          '-loop', '1',
          '-i', `input_${i}.jpg`,
          '-i', `audio_${i}.mp3`,
          '-c:v', 'libx264',
          '-tune', 'stillimage',
          '-c:a', 'aac',
          '-b:a', '192k',
          '-pix_fmt', 'yuv420p',
          '-shortest',
          '-vf', `zoompan=z='min(zoom+0.0015,${zoomFactor})':d=${duration * 30}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)',fps=25`,
          `-t`, `${duration}`,
          `video_${i}.mp4`
        ]);

        videoFiles.push(`video_${i}.mp4`);
      }

      setCurrentStep('正在拼接所有片段...');
      setProgress(70);

      // 创建文件列表
      const fileListContent = videoFiles.map(file => `file '${file}'`).join('\n');
      await ffmpeg.writeFile('concat.txt', fileListContent);

      // 拼接所有视频
      await ffmpeg.exec([
        '-f', 'concat',
        '-safe', '0',
        '-i', 'concat.txt',
        '-c', 'copy',
        'output.mp4'
      ]);

      setCurrentStep('正在生成最终视频...');
      setProgress(90);

      // 读取输出文件
      const data = await ffmpeg.readFile('output.mp4');
      const uint8Array = new Uint8Array(data as unknown as ArrayBuffer);
      const blob = new Blob([uint8Array.buffer], { type: 'video/mp4' });
      const url = URL.createObjectURL(blob);

      setBrowserVideoUrl(url);
      setProgress(100);
      setCurrentStep('视频拼接完成！');

      // 自动下载
      const a = document.createElement('a');
      a.href = url;
      a.download = `book-video-${Date.now()}.mp4`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

    } catch (err) {
      if (err instanceof Error) {
        console.error('浏览器端拼接失败:', err);
        setError(`拼接失败: ${err.message}`);
      } else {
        setError('拼接失败：未知错误');
      }
    } finally {
      setIsConcatImageAudio(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-pink-50 to-orange-50 dark:from-gray-900 dark:via-purple-950 dark:to-pink-950">
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="flex items-center justify-center gap-3 mb-4">
            <Video className="h-12 w-12 text-purple-600 dark:text-purple-400" />
            <h1 className="text-4xl md:text-5xl font-bold bg-gradient-to-r from-purple-600 via-pink-600 to-orange-600 bg-clip-text text-transparent">
              图书讲解视频生成器
            </h1>
          </div>
          <p className="text-gray-600 dark:text-gray-300 text-lg">
            输入书名，AI 自动生成专业诙谐的讲解视频
          </p>
        </div>

        {/* Input Section */}
        <Card className="mb-8 border-2 border-purple-200 dark:border-purple-800">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5" />
              开始创作
            </CardTitle>
            <CardDescription>输入你想讲解的书籍名称</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <Input
                placeholder="例如：《人类简史》、《三体》、《思考，快与慢》"
                value={bookName}
                onChange={(e) => setBookName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !isGenerating && handleGenerate()}
                className="text-lg h-12"
                disabled={isGenerating}
              />
              <div className="space-y-3">
                <div className="text-sm font-medium text-gray-700 dark:text-gray-300">生成模式</div>
                <RadioGroup value={generateMode} onValueChange={(v) => setGenerateMode(v as 'video' | 'image')} disabled={isGenerating}>
                  <div className="flex items-center gap-6">
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="video" id="video" />
                      <Label htmlFor="video" className="flex items-center gap-2 cursor-pointer">
                        <Video className="h-4 w-4" />
                        <span>生成视频（AI配音）</span>
                      </Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="image" id="image" />
                      <Label htmlFor="image" className="flex items-center gap-2 cursor-pointer">
                        <Image className="h-4 w-4" />
                        <span>生成图片+音频</span>
                      </Label>
                    </div>
                  </div>
                </RadioGroup>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {generateMode === 'video' ? (
                    <span>使用AI生成视频片段，自动配音，生成速度快但风格受限</span>
                  ) : (
                    <span>分别生成精美图片和音频，可自行拼接，风格更多样但需手动处理</span>
                  )}
                </div>
              </div>

              <div className="space-y-3">
                <div className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
                  <Music className="h-4 w-4" />
                  配音音色
                </div>
                <div className="space-y-2">
                  {voiceCategories.map((category) => (
                    <div key={category} className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                      <div className="bg-gray-50 dark:bg-gray-800 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 border-b border-gray-200 dark:border-gray-700">
                        {category}
                      </div>
                      <div className="p-2 space-y-1">
                        {voiceOptions.filter(v => v.category === category).map((voice) => (
                          <div
                            key={voice.id}
                            className={`flex items-start gap-2 p-2 rounded-md cursor-pointer transition-colors ${
                              selectedVoice === voice.id
                                ? 'bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800'
                                : 'hover:bg-gray-50 dark:hover:bg-gray-800 border border-transparent'
                            }`}
                            onClick={(e) => {
                              if (e.target === e.currentTarget) {
                                !isGenerating && setSelectedVoice(voice.id);
                              }
                            }}
                          >
                            <div className="flex items-center justify-center w-4 h-4 mt-0.5">
                              <div
                                className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                                  selectedVoice === voice.id
                                    ? 'border-purple-600 dark:border-purple-400 bg-purple-600 dark:bg-purple-400'
                                    : 'border-gray-300 dark:border-gray-600'
                                }`}
                              >
                                {selectedVoice === voice.id && (
                                  <div className="w-1.5 h-1.5 bg-white rounded-full" />
                                )}
                              </div>
                            </div>
                            <div
                              className="flex-1 min-w-0"
                              onClick={() => !isGenerating && setSelectedVoice(voice.id)}
                            >
                              <div
                                className={`font-medium block ${
                                  selectedVoice === voice.id ? 'text-purple-700 dark:text-purple-400' : 'text-gray-900 dark:text-gray-100'
                                }`}
                              >
                                {voice.name}
                              </div>
                              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{voice.description}</p>
                            </div>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (!previewLoading && !isGenerating) {
                                  handlePlayVoicePreview(voice.id, voice.name);
                                }
                              }}
                              disabled={previewLoading || isGenerating}
                              className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
                                playingVoiceId === voice.id
                                  ? 'bg-purple-600 text-white'
                                  : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                              }`}
                            >
                              {playingVoiceId === voice.id ? (
                                <VolumeX className="h-4 w-4" />
                              ) : previewLoading && playingVoiceId !== voice.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Volume2 className="h-4 w-4" />
                              )}
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <Button
                onClick={isGenerating ? handleCancel : handleGenerate}
                disabled={isGenerating || !bookName.trim()}
                className="w-full h-12 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    取消
                  </>
                ) : (
                  <>
                    <Play className="mr-2 h-4 w-4" />
                    {generateMode === 'video' ? '生成视频' : '生成图片+音频'}
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Progress Bar */}
        {isGenerating && (
          <Card className="mb-8 border-2 border-pink-200 dark:border-pink-800">
            <CardContent className="pt-6">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {currentStep}
                  </span>
                  <span className="text-sm font-bold text-purple-600 dark:text-purple-400">
                    {progress}%
                  </span>
                </div>
                <Progress value={progress} className="h-2" />
              </div>
            </CardContent>
          </Card>
        )}

        {/* Error */}
        {error && (
          <Card className="mb-8 border-2 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/20">
            <CardContent className="pt-6">
              <div className="text-red-600 dark:text-red-400">
                <div className="flex items-start gap-3">
                  <AlertCircle className="h-5 w-5 mt-0.5 flex-shrink-0" />
                  <div className="font-medium whitespace-pre-wrap">
                    {error}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Local Files Section - Always visible */}
        <Card className="mb-8 border-2 border-orange-200 dark:border-orange-800">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Scissors className="h-5 w-5" />
              本地文件拼接
            </CardTitle>
            <CardDescription>
              扫描本地目录中的图片和音频文件，按序号自动匹配并拼接成视频
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Input
                placeholder="输入本地目录路径，例如: /tmp/video-gen-123456"
                value={localDirPath}
                onChange={(e) => setLocalDirPath(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleScanLocalDir()}
                disabled={isScanning}
              />
              <Button 
                onClick={handleScanLocalDir}
                disabled={isScanning}
                className="bg-orange-600 hover:bg-orange-700"
              >
                {isScanning ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    扫描中
                  </>
                ) : (
                  <>
                    <Search className="h-4 w-4 mr-2" />
                    扫描
                  </>
                )}
              </Button>
            </div>

            {currentStep?.includes('找到') && (
              <div className="bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 rounded-lg p-3">
                <p className="text-green-700 dark:text-green-400">{currentStep}</p>
              </div>
            )}

            {localMatches.length > 0 && (
              <>
                <div className="flex gap-2">
                  <Button
                    onClick={handleConcatInBrowser}
                    disabled={isConcatImageAudio}
                    className="flex-1 bg-purple-600 hover:bg-purple-700"
                  >
                    {isConcatImageAudio ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        拼接中...
                      </>
                    ) : (
                      <>
                        <Film className="h-4 w-4 mr-2" />
                        浏览器端拼接
                      </>
                    )}
                  </Button>
                  <Button
                    onClick={handleDownloadAllSegments}
                    variant="outline"
                    className="bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700"
                  >
                    <Download className="h-4 w-4 mr-2" />
                    下载提示
                  </Button>
                </div>

                {isConcatImageAudio && progress > 0 && (
                  <div className="space-y-2">
                    <Progress value={progress} className="h-2" />
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      {currentStep}
                    </p>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {localMatches.map((segment) => (
                    <Card key={segment.index} className="border border-gray-200 dark:border-gray-700">
                      <CardContent className="p-3">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="bg-orange-600 text-white text-xs px-2 py-0.5 rounded">
                            #{segment.index + 1}
                          </span>
                          <span className="text-sm text-gray-600 dark:text-gray-400">
                            {segment.duration}秒
                          </span>
                        </div>
                        {segment.imageUrl && (
                          <div className="mb-2">
                            <img
                              src={segment.imageUrl}
                              alt={`片段 ${segment.index + 1}`}
                              className="w-full h-32 object-cover rounded"
                            />
                          </div>
                        )}
                        {segment.audioUrl && (
                          <div className="flex items-center gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                const audio = new Audio(segment.audioUrl);
                                audio.play();
                              }}
                            >
                              <PlayCircle className="h-4 w-4 mr-1" />
                              播放音频
                            </Button>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Main Content */}
        {(outline || script || videoSegments.length > 0 || finalVideoUrl) && (
          <Tabs defaultValue="segments" className="mb-8">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="segments" className="flex items-center gap-2">
                <Video className="h-4 w-4" />
                视频片段
                {videoSegments.length > 0 && (
                  <span className="ml-1 bg-purple-600 text-white text-xs px-2 py-0.5 rounded-full">
                    {videoSegments.length}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="script">
                <FileText className="h-4 w-4" />
                文案
              </TabsTrigger>
              <TabsTrigger value="outline">
                <Image className="h-4 w-4" />
                大纲
              </TabsTrigger>
              <TabsTrigger value="final" disabled={!finalVideoUrl && !fallbackMode}>
                <CheckCircle2 className="h-4 w-4" />
                完整视频
              </TabsTrigger>
            </TabsList>

            {/* Video Segments Tab */}
            <TabsContent value="segments" className="space-y-4">
              {/* 混合模式提示 */}
              {videoSegments.some(s => s.videoUrl) && videoSegments.some(s => s.imageUrl) && (
                <Card className="mb-4 border-2 border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/20">
                  <CardContent className="pt-4">
                    <div className="flex items-center gap-3 text-blue-700 dark:text-blue-400">
                      <AlertCircle className="h-5 w-5" />
                      <div>
                        <p className="font-semibold">混合模式</p>
                        <p className="text-sm">
                          部分片段使用视频，部分片段使用图片+音频
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
              
              {/* 降级模式提示 */}
              {fallbackMode && (
                <Card className="mb-4 border-2 border-yellow-200 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-950/20">
                  <CardContent className="pt-4">
                    <div className="flex items-center gap-3 text-yellow-700 dark:text-yellow-400">
                      <AlertCircle className="h-5 w-5" />
                      <div>
                        <p className="font-semibold">幻灯片模式</p>
                        <p className="text-sm">
                          视频生成暂时不可用，已为您生成图片+音频讲解
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
              
              <div className="grid gap-4">
                {videoSegments.map((segment) => (
                  <Card key={segment.index} className="border-2 border-purple-200 dark:border-purple-800">
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-lg flex items-center gap-2">
                          <div className="bg-purple-600 text-white w-8 h-8 rounded-full flex items-center justify-center text-sm">
                            {segment.index + 1}
                          </div>
                          片段 {segment.index + 1} / {segment.total}
                          {segment.videoUrl && (
                            <span className="ml-2 text-xs bg-green-100 text-green-800 px-2 py-1 rounded">
                              视频
                            </span>
                          )}
                          {segment.imageUrl && (
                            <span className="ml-2 text-xs bg-yellow-100 text-yellow-800 px-2 py-1 rounded">
                              图片+音频
                            </span>
                          )}
                        </CardTitle>
                        <span className="text-sm text-gray-500">{segment.duration}秒</span>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        <p className="text-gray-700 dark:text-gray-300 font-medium">
                          {segment.sentence}
                        </p>
                        {segment.videoUrl ? (
                          // 显示视频
                          <div className="aspect-video bg-black rounded-lg overflow-hidden">
                            <video
                              src={segment.videoUrl}
                              controls
                              className="w-full h-full"
                            />
                          </div>
                        ) : segment.imageUrl ? (
                          // 降级模式：显示图片+音频
                          <div className="space-y-3">
                            <div className="aspect-video bg-gray-100 dark:bg-gray-800 rounded-lg overflow-hidden">
                              {segment.imageUrl ? (
                                <img
                                  src={segment.imageUrl}
                                  alt={`片段 ${segment.index + 1}`}
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <div className="flex items-center justify-center h-full text-gray-400">
                                  <Loader2 className="h-8 w-8 animate-spin" />
                                </div>
                              )}
                            </div>
                            {segment.audioUrl && (
                              <div className="flex items-center gap-3">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="flex items-center gap-2"
                                  onClick={() => {
                                    const audio = new Audio(segment.audioUrl);
                                    audio.play();
                                  }}
                                >
                                  <PlayCircle className="h-4 w-4" />
                                  播放配音
                                </Button>
                                <span className="text-sm text-gray-500">点击播放该片段的语音解说</span>
                              </div>
                            )}
                          </div>
                        ) : (
                          // 生成中
                          <div className="aspect-video bg-gray-100 dark:bg-gray-800 rounded-lg overflow-hidden flex items-center justify-center">
                            <Loader2 className="h-8 w-8 animate-spin text-purple-600" />
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {isGenerating && videoSegments.length > 0 && (
                <div className="text-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin mx-auto mb-3 text-purple-600" />
                  <p className="text-gray-600 dark:text-gray-400">
                    正在生成剩余片段... ({videoSegments.length} 已完成)
                  </p>
                </div>
              )}
            </TabsContent>

            {/* Script Tab */}
            <TabsContent value="script">
              <Card className="border-2 border-pink-200 dark:border-pink-800">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <FileText className="h-5 w-5" />
                    讲解文案
                    {script && (
                      <span className="ml-2 text-sm text-gray-500">
                        ({script.length} 字)
                      </span>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {script ? (
                    <div className="prose dark:prose-invert max-w-none">
                      {script.split(/(?<=[。！？.!?])\s+/).map((sentence, index) => (
                        <p key={index} className="mb-2 text-gray-700 dark:text-gray-300">
                          {sentence.trim()}
                        </p>
                      ))}
                    </div>
                  ) : (
                    <div className="flex items-center justify-center py-8 text-gray-400">
                      <Loader2 className="h-8 w-8 animate-spin mr-3" />
                      正在生成文案...
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Outline Tab */}
            <TabsContent value="outline">
              <Card className="border-2 border-orange-200 dark:border-orange-800">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Image className="h-5 w-5" />
                    内容大纲
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {outline ? (
                    <div className="prose dark:prose-invert max-w-none whitespace-pre-wrap text-gray-700 dark:text-gray-300">
                      {outline}
                    </div>
                  ) : (
                    <div className="flex items-center justify-center py-8 text-gray-400">
                      <Loader2 className="h-8 w-8 animate-spin mr-3" />
                      正在生成大纲...
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Final Video Tab */}
            <TabsContent value="final">
              {fallbackMode ? (
                // 降级模式：显示说明
                <Card className="border-2 border-yellow-200 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-950/20">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <AlertCircle className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
                      视频生成服务暂不可用
                    </CardTitle>
                    <CardDescription>
                      当前环境中视频生成API暂时无法使用，已为您生成图片+语音解说的替代方案
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      <div className="p-4 bg-white dark:bg-gray-800 rounded-lg">
                        <p className="text-sm text-gray-700 dark:text-gray-300">
                          您可以在"视频片段"标签页中查看所有生成的图片和播放对应的语音解说。
                          每个片段都包含一张配图和相应的音频讲解。
                        </p>
                      </div>
                      <Button
                        onClick={() => {
                          // 切换到第一个标签页（视频片段）
                          const tabsContainer = document.querySelector('[role="tablist"]')?.parentElement;
                          const tabs = tabsContainer?.querySelectorAll('[role="tab"]');
                          tabs?.[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                        }}
                        className="w-full"
                      >
                        查看图片和语音解说
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                // 正常模式：显示完整视频或拼接按钮
                <Card className="border-2 border-green-200 dark:border-green-800">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <CheckCircle2 className="h-5 w-5" />
                      完整视频
                      {finalVideoUrl && (
                        <span className="ml-2 text-xs bg-green-100 text-green-800 px-2 py-1 rounded">
                          已生成
                        </span>
                      )}
                      {!finalVideoUrl && canConcat && (
                        <span className="ml-2 text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">
                          待拼接
                        </span>
                      )}
                    </CardTitle>
                    <CardDescription>
                      {finalVideoUrl
                        ? '所有片段已拼接完成'
                        : (canConcat 
                            ? '已生成多个视频片段，可点击按钮拼接成完整视频'
                            : '等待视频片段生成完成...')}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      {/* 如果有完整视频，显示视频 */}
                      {finalVideoUrl && (
                        <div className="aspect-video bg-black rounded-lg overflow-hidden">
                          <video
                            src={finalVideoUrl}
                            controls
                            className="w-full h-full"
                          />
                        </div>
                      )}
                      
                      {/* 拼接视频按钮 - 有多个视频片段且未拼接完成时显示 */}
                      {canConcat && !finalVideoUrl && !isConcatenating && !isConcatImageAudio && (
                        <Button
                          onClick={handleConcatVideo}
                          className="w-full bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
                        >
                          <Scissors className="mr-2 h-4 w-4" />
                          拼接完整视频 ({videoSegments.length} 个片段)
                        </Button>
                      )}

                      {/* 图片+音频拼接按钮 - 有图片+音频片段且未拼接完成时显示 */}
                      {canConcatImageAudio && !finalVideoUrl && !isConcatenating && !isConcatImageAudio && (
                        <Button
                          onClick={handleConcatImageAudio}
                          className="w-full bg-gradient-to-r from-green-600 to-teal-600 hover:from-green-700 hover:to-teal-700"
                        >
                          <Image className="mr-2 h-4 w-4" />
                          拼接图片+音频 ({videoSegments.length} 个片段)
                        </Button>
                      )}

                      {/* 拼接进度 */}
                      {(isConcatenating || isConcatImageAudio) && (
                        <Card className="border-2 border-blue-200 dark:border-blue-800">
                          <CardContent className="pt-4">
                            <div className="space-y-2">
                              <div className="flex items-center justify-between">
                                <span className="text-sm font-medium flex items-center gap-2">
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                  {currentStep}
                                </span>
                                <span className="text-sm font-bold text-blue-600 dark:text-blue-400">
                                  {progress}%
                                </span>
                              </div>
                              <Progress value={progress} className="h-2" />
                            </div>
                          </CardContent>
                        </Card>
                      )}

                      {/* 下载按钮 */}
                      {finalVideoUrl && (
                        <Button
                          onClick={downloadVideo}
                          className="w-full bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700"
                        >
                          <Download className="mr-2 h-4 w-4" />
                          下载视频
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}
            </TabsContent>
          </Tabs>
        )}

        {/* Complete Message */}
        {!isGenerating && !isConcatenating && (finalVideoUrl || fallbackMode || canConcat) && (
          <Card className="border-2 border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/20">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3 text-green-600 dark:text-green-400">
                <CheckCircle2 className="h-6 w-6" />
                <div className="flex-1">
                  <p className="font-semibold text-lg">
                    {fallbackMode 
                      ? '内容生成完成（幻灯片模式）！' 
                      : (finalVideoUrl ? '视频生成完成！' : '视频片段生成完成！')}
                  </p>
                  <p className="text-sm">
                    共生成 {videoSegments.length} 个片段
                    {fallbackMode 
                      ? '，包含图片和语音解说' 
                      : (finalVideoUrl ? '，已拼接成完整视频' : '，可点击按钮拼接成完整视频')}
                  </p>
                </div>
              </div>
              
              {/* 拼接视频按钮 */}
              {canConcat && !finalVideoUrl && !fallbackMode && !isConcatenating && !isConcatImageAudio && (
                <div className="mt-4">
                  <Button
                    onClick={handleConcatVideo}
                    className="w-full bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
                  >
                    <Scissors className="mr-2 h-4 w-4" />
                    拼接完整视频
                  </Button>
                </div>
              )}

              {/* 图片+音频拼接按钮 */}
              {canConcatImageAudio && !finalVideoUrl && !isConcatenating && !isConcatImageAudio && (
                <div className="mt-4">
                  <Button
                    onClick={handleConcatImageAudio}
                    className="w-full bg-gradient-to-r from-green-600 to-teal-600 hover:from-green-700 hover:to-teal-700"
                  >
                    <Image className="mr-2 h-4 w-4" />
                    拼接图片+音频
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
