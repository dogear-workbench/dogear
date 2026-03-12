import { useState } from 'react';
import { HelpCircle, Send } from 'lucide-react';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { client } from '@/lib/client';
import type { ContentBlock } from './types';

/**
 * AskUserQuestion 卡片组件
 * 当 SDK 触发 AskUserQuestion 工具时，展示结构化问答 UI
 */
export function AskUserQuestionCard({
  block,
  sessionId,
  onResolved,
}: {
  block: ContentBlock;
  sessionId: string | null;
  onResolved: (requestId: string, answers: Record<string, string>) => void;
}) {
  const questions = block.askUserQuestions || [];
  const isResolved = !!block.askUserResolved;

  // 每个问题的答案状态：key=问题文本, value=选中的选项 label 或自由文本
  const [answers, setAnswers] = useState<Record<string, string>>({});
  // 多选问题的状态：key=问题文本, value=选中的选项 label 数组
  const [multiAnswers, setMultiAnswers] = useState<Record<string, string[]>>({});
  // 每个问题是否选择"其他"
  const [otherActive, setOtherActive] = useState<Record<string, boolean>>({});
  // "其他"的自由文本
  const [otherTexts, setOtherTexts] = useState<Record<string, string>>({});

  const handleSubmit = async () => {
    if (!sessionId || !block.askUserRequestId || isResolved) return;

    // 构建最终答案
    const finalAnswers: Record<string, string> = {};
    for (const q of questions) {
      const key = q.question;
      if (q.multiSelect) {
        const selected = multiAnswers[key] || [];
        if (otherActive[key] && otherTexts[key]?.trim()) {
          selected.push(otherTexts[key].trim());
        }
        finalAnswers[key] = selected.join(', ');
      } else {
        if (otherActive[key] && otherTexts[key]?.trim()) {
          finalAnswers[key] = otherTexts[key].trim();
        } else {
          finalAnswers[key] = answers[key] || '';
        }
      }
    }

    await client.respondAskUserQuestion({
      sessionId,
      requestId: block.askUserRequestId,
      answers: finalAnswers,
    });
    onResolved(block.askUserRequestId, finalAnswers);
  };

  return (
    <div className={`rounded-lg border-2 ${isResolved ? 'border-blue-200 bg-blue-50/30' : 'border-indigo-300 bg-indigo-50/50'} p-4`}>
      <div className="flex items-center gap-2 mb-3">
        <HelpCircle size={16} className={isResolved ? 'text-blue-400' : 'text-indigo-600'} />
        <span className={`text-sm font-medium ${isResolved ? 'text-blue-500' : 'text-indigo-800'}`}>
          {isResolved ? '已回答' : 'AI 想了解更多信息'}
        </span>
      </div>

      <div className="space-y-4">
        {questions.map((q, qi) => (
          <div key={qi} className="space-y-2">
            {q.header && (
              <span className="text-xs px-1.5 py-0.5 bg-indigo-100 rounded text-indigo-600 font-medium">{q.header}</span>
            )}
            <p className="text-sm text-gray-800 font-medium">{q.question}</p>

            {isResolved ? (
              // 已回答：只读显示
              <div className="text-sm text-gray-600 bg-white/60 rounded p-2">
                {block.askUserAnswers?.[q.question] || '(未回答)'}
              </div>
            ) : q.multiSelect ? (
              // 多选
              <div className="space-y-1.5">
                {q.options.map((opt, oi) => (
                  <div key={oi} className="flex items-start gap-2">
                    <Checkbox
                      id={`q${qi}-opt${oi}`}
                      checked={(multiAnswers[q.question] || []).includes(opt.label)}
                      onCheckedChange={(checked) => {
                        const current = multiAnswers[q.question] || [];
                        const updated = checked
                          ? [...current, opt.label]
                          : current.filter(l => l !== opt.label);
                        setMultiAnswers(prev => ({ ...prev, [q.question]: updated }));
                      }}
                    />
                    <div>
                      <Label htmlFor={`q${qi}-opt${oi}`} className="text-sm cursor-pointer">{opt.label}</Label>
                      {opt.description && <p className="text-xs text-gray-500 mt-0.5">{opt.description}</p>}
                    </div>
                  </div>
                ))}
                {/* 其他选项 */}
                <div className="flex items-start gap-2">
                  <Checkbox
                    id={`q${qi}-other`}
                    checked={!!otherActive[q.question]}
                    onCheckedChange={(checked) => setOtherActive(prev => ({ ...prev, [q.question]: !!checked }))}
                  />
                  <div className="flex-1">
                    <Label htmlFor={`q${qi}-other`} className="text-sm cursor-pointer">其他</Label>
                    {otherActive[q.question] && (
                      <Input
                        value={otherTexts[q.question] || ''}
                        onChange={(e) => setOtherTexts(prev => ({ ...prev, [q.question]: e.target.value }))}
                        placeholder="请输入..."
                        className="mt-1 text-sm"
                        autoFocus
                      />
                    )}
                  </div>
                </div>
              </div>
            ) : (
              // 单选
              <RadioGroup
                value={otherActive[q.question] ? '__other__' : (answers[q.question] || '')}
                onValueChange={(val) => {
                  if (val === '__other__') {
                    setOtherActive(prev => ({ ...prev, [q.question]: true }));
                  } else {
                    setOtherActive(prev => ({ ...prev, [q.question]: false }));
                    setAnswers(prev => ({ ...prev, [q.question]: val }));
                  }
                }}
                className="space-y-1.5"
              >
                {q.options.map((opt, oi) => (
                  <div key={oi} className="flex items-start gap-2">
                    <RadioGroupItem value={opt.label} id={`q${qi}-opt${oi}`} className="mt-0.5" />
                    <div>
                      <Label htmlFor={`q${qi}-opt${oi}`} className="text-sm cursor-pointer">{opt.label}</Label>
                      {opt.description && <p className="text-xs text-gray-500 mt-0.5">{opt.description}</p>}
                    </div>
                  </div>
                ))}
                {/* 其他选项 */}
                <div className="flex items-start gap-2">
                  <RadioGroupItem value="__other__" id={`q${qi}-other`} className="mt-0.5" />
                  <div className="flex-1">
                    <Label htmlFor={`q${qi}-other`} className="text-sm cursor-pointer">其他</Label>
                    {otherActive[q.question] && (
                      <Input
                        value={otherTexts[q.question] || ''}
                        onChange={(e) => setOtherTexts(prev => ({ ...prev, [q.question]: e.target.value }))}
                        placeholder="请输入..."
                        className="mt-1 text-sm"
                        autoFocus
                      />
                    )}
                  </div>
                </div>
              </RadioGroup>
            )}
          </div>
        ))}
      </div>

      {/* 提交按钮 */}
      {!isResolved && (
        <div className="mt-4">
          <Button size="sm" onClick={handleSubmit}>
            <Send size={14} />
            提交回答
          </Button>
        </div>
      )}
    </div>
  );
}
