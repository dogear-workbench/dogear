import { useState, useRef, useCallback, useEffect } from 'react';
import { toast } from 'sonner';

export interface PendingImage {
  file: File;
  preview: string;
  base64: string;
  mediaType: string;
}

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export function fileToBase64Data(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // 移除 data:image/...;base64, 前缀
      resolve(result.split(',')[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// 过滤非图片并拦截超限文件（上限与主进程 read 图片分支对齐），返回可接受的图片文件
export async function acceptImageFiles(files: FileList | File[]): Promise<File[]> {
  const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
  if (imageFiles.length === 0) return [];
  const accepted: File[] = [];
  let rejected = 0;
  for (const file of imageFiles) {
    if (file.size > MAX_IMAGE_BYTES) rejected++;
    else accepted.push(file);
  }
  if (rejected > 0) {
    toast.error(`${rejected} 张图片超过 5MB 上限，未添加`);
  }
  return accepted;
}

export function useImageAttachment() {
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const handleImageFiles = useCallback(async (files: FileList | File[]) => {
    const accepted = await acceptImageFiles(files);
    if (accepted.length === 0) return;
    const newImages = await Promise.all(accepted.map(async (file) => ({
      file,
      preview: URL.createObjectURL(file),
      base64: await fileToBase64Data(file),
      mediaType: file.type,
    })));
    setPendingImages(prev => [...prev, ...newImages]);
  }, []);

  // 移除待发送图片
  const removePendingImage = useCallback((index: number) => {
    setPendingImages(prev => {
      const removed = prev[index];
      if (removed) URL.revokeObjectURL(removed.preview);
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  // 清理预览 URL
  useEffect(() => {
    return () => {
      pendingImages.forEach(img => URL.revokeObjectURL(img.preview));
    };
  }, []);

  return {
    pendingImages,
    setPendingImages,
    imageInputRef,
    handleImageFiles,
    removePendingImage,
  };
}
