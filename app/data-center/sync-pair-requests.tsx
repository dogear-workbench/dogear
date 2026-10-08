import { Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useSyncStore, PAIR_REQUEST_TTL_MS } from '@/stores/sync-store';
import { pairRequestDisplayName, shortDeviceIdText } from './sync-utils';

export function PairRequestCards({ now }: { now: number }) {
  const pendingPairRequests = useSyncStore((s) => s.pendingPairRequests);
  const confirmPairRequest = useSyncStore((s) => s.confirmPairRequest);
  const rejectPairRequest = useSyncStore((s) => s.rejectPairRequest);

  const active = pendingPairRequests.filter((r) => now - r.createdAt < PAIR_REQUEST_TTL_MS);
  if (active.length === 0) return null;

  return (
    <div className="space-y-2">
      {active.map((request) => (
        <Card key={request.requestId} className="border-primary/40">
          <CardContent className="py-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <div className="text-sm font-medium">
                  来自「{pairRequestDisplayName(request)}」的配对请求
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  设备 <span className="font-mono">{shortDeviceIdText(request.peer.deviceId)}</span>
                  ，请核对两侧配对码一致后确认
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-mono text-lg font-semibold tracking-[0.3em]">{request.code}</span>
                <div className="flex gap-1.5">
                  <Button size="sm" onClick={() => void confirmPairRequest(request.requestId)}>
                    <Check className="w-3.5 h-3.5" />
                    确认配对
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void rejectPairRequest(request.requestId)}>
                    <X className="w-3.5 h-3.5" />
                    拒绝
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
