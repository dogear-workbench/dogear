import { useState, useRef, useCallback, useEffect } from 'react';

export interface PendingImage {
  file: File;
  preview: string;
  base64: string;
  mediaType: string;
}

export function useImageAttachment() {
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const imageInputRef = useRef<HTMLInputElement>(null);

  // 图片文件转 base64
  const fileToBase64 = useCallback((file: File): Promise<string> => {
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
  }, []);

  // 处理图片文件选择
  const handleImageFiles = useCallback(async (files: FileList | File[]) => {
    const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
    if (imageFiles.length === 0) return;
    const newImages = await Promise.all(imageFiles.map(async (file) => ({
      file,
      preview: URL.createObjectURL(file),
      base64: await fileToBase64(file),
      mediaType: file.type,
    })));
    setPendingImages(prev => [...prev, ...newImages]);
  }, [fileToBase64]);

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
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    pendingImages,
    setPendingImages,
    imageInputRef,
    handleImageFiles,
    removePendingImage,
  };
}
