import { useEffect, useState } from 'react';
import { client } from '@/lib/client';

interface TitleBarProps {
  title: string;
}

export function TitleBar({ title }: TitleBarProps) {
  const [isMac, setIsMac] = useState(false);

  useEffect(() => {
    client.getPlatform()
      .then((platform) => setIsMac(platform === 'darwin'))
      .catch(() => {});
  }, []);

  return (
    <div
      className={`fixed top-0 left-0 right-0 z-[9998] pointer-events-none flex items-center ${isMac ? 'pl-20 pr-4' : 'pl-4 pr-32'}`}
      style={{ height: 'env(titlebar-area-height, 36px)' }}
    >
      <span className="text-xs font-medium text-muted-foreground truncate">{title}</span>
    </div>
  );
}
