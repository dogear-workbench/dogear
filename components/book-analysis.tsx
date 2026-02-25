'use client';

import { useState, useEffect } from 'react';
import { Book } from '@/types';
import type { BookAnalysis, ChapterAnalysis, BookAnalysisUpdate } from '@/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Sparkles, AlertCircle, CheckCircle2, Loader2, BookOpen, FileText } from 'lucide-react';
import { client } from '@/lib/client';
import { rendererEvents } from '@/lib/events';

interface BookAnalysisPanelProps {
  book: Book;
  onUpdate?: () => void;
}

/**
 * 书籍分析面板组件
 * 显示分析状态、结果，并提供分析操作入口
 */
export function BookAnalysis({ book, onUpdate }: BookAnalysisPanelProps) {
  const [analysisStatus, setAnalysisStatus] = useState<'none' | 'analyzing' | 'analyzed' | 'failed'>('none');
  const [analysisResult, setAnalysisResult] = useState<BookAnalysis | null>(null);
  const [chapterAnalyses, setChapterAnalyses] = useState<ChapterAnalysis[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState<string>('');
  const [analyzedChapters, setAnalyzedChapters] = useState(0);

  // 加载分析状态
  useEffect(() => {
    loadAnalysisStatus();
  }, [book.id]);

  // 监听分析进度事件
  useEffect(() => {
    const unsubscribe = rendererEvents.analysisUpdate.listen((data: BookAnalysisUpdate) => {
      if (data.bookId === book.id) {
        if (data.toolName) {
          setCurrentStep(`正在执行: ${data.toolName}`);
        }
        if (data.chapterSaved && data.chapterTitle) {
          setAnalyzedChapters(prev => prev + 1);
          setCurrentStep(`已分析: ${data.chapterTitle}`);
        }
        if (data.message) {
          setCurrentStep(data.message);
        }
        if (data.status === 'completed') {
          setAnalysisStatus('analyzed');
          setLoading(false);
          loadAnalysisStatus();
          onUpdate?.();
        }
        if (data.error) {
          setError(data.error);
          setAnalysisStatus('failed');
          setLoading(false);
        }
      }
    });

    return unsubscribe;
  }, [book.id, onUpdate]);

  const loadAnalysisStatus = async () => {
    try {
      const statusData = await client.getAnalysisStatus({ bookId: book.id! });
      setAnalysisStatus(statusData.status as typeof analysisStatus);
      setAnalysisResult(statusData.result as BookAnalysis | null);
      setError(statusData.error || null);

      if (statusData.status === 'analyzed') {
        const chaptersData = await client.getChapterAnalyses({ bookId: book.id! });
        setChapterAnalyses(chaptersData.analyses as ChapterAnalysis[]);
        setAnalyzedChapters(chaptersData.analyses.length);
      }
    } catch (err) {
      console.error('加载分析状态失败:', err);
    }
  };

  const startAnalysis = async () => {
    if (!book.id) return;

    setLoading(true);
    setError(null);
    setAnalyzedChapters(0);
    setCurrentStep('正在启动分析...');

    try {
      const result = await client.analyzeBook({ bookId: book.id });
      if (result.error) {
        setError(result.error);
        setLoading(false);
      } else {
        setAnalysisStatus('analyzing');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
    }
  };

  const getStatusDisplay = () => {
    switch (analysisStatus) {
      case 'none':
        return (
          <div className="text-center py-8">
            <Sparkles className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
            <h3 className="text-lg font-semibold mb-2">开始分析</h3>
            <p className="text-sm text-muted-foreground mb-4">
              使用 AI 分析书籍内容，自动识别类型并生成摘要
            </p>
            <Button onClick={startAnalysis} disabled={loading}>
              {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
              开始分析
            </Button>
          </div>
        );

      case 'analyzing':
        return (
          <div className="text-center py-8">
            <Loader2 className="w-12 h-12 mx-auto mb-4 animate-spin text-primary" />
            <h3 className="text-lg font-semibold mb-2">正在分析...</h3>
            <p className="text-sm text-muted-foreground mb-2">{currentStep || 'AI 正在处理中...'}</p>
            {analyzedChapters > 0 && (
              <p className="text-xs text-muted-foreground">已分析 {analyzedChapters} 章</p>
            )}
          </div>
        );

      case 'analyzed':
        if (!analysisResult) {
          return (
            <div className="text-center py-8">
              <CheckCircle2 className="w-12 h-12 mx-auto mb-4 text-green-500" />
              <h3 className="text-lg font-semibold mb-2">分析完成</h3>
              <Button onClick={loadAnalysisStatus} variant="outline" size="sm">
                查看结果
              </Button>
            </div>
          );
        }
        return <AnalysisResultView analysis={analysisResult} chapters={chapterAnalyses} />;

      case 'failed':
        return (
          <div className="text-center py-8">
            <AlertCircle className="w-12 h-12 mx-auto mb-4 text-destructive" />
            <h3 className="text-lg font-semibold mb-2">分析失败</h3>
            <p className="text-sm text-destructive mb-4">{error || '未知错误'}</p>
            <Button onClick={startAnalysis} variant="outline">
              重试
            </Button>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5" />
              AI 分析
            </CardTitle>
            <CardDescription>智能分析书籍内容</CardDescription>
          </div>
          <AnalysisStatusBadge status={analysisStatus} />
        </div>
      </CardHeader>
      <CardContent>
        {getStatusDisplay()}
      </CardContent>
    </Card>
  );
}

/**
 * 分析状态徽章
 */
function AnalysisStatusBadge({ status }: { status: 'none' | 'analyzing' | 'analyzed' | 'failed' }) {
  switch (status) {
    case 'none':
      return <Badge variant="outline">未分析</Badge>;
    case 'analyzing':
      return (
        <Badge variant="default" className="animate-pulse">
          <Loader2 className="w-3 h-3 mr-1 animate-spin" />
          分析中
        </Badge>
      );
    case 'analyzed':
      return <Badge variant="default" className="bg-green-500">已分析</Badge>;
    case 'failed':
      return <Badge variant="destructive">失败</Badge>;
  }
}

/**
 * 分析结果展示视图
 */
function AnalysisResultView({
  analysis,
  chapters
}: {
  analysis: BookAnalysis;
  chapters: ChapterAnalysis[];
}) {
  const renderContentFields = () => {
    const commonFields = ['analyzedAt', 'model', 'contentType'];

    return Object.entries(analysis)
      .filter(([key]) => !commonFields.includes(key))
      .map(([key, value]) => {
        if (Array.isArray(value)) {
          return (
            <div key={key} className="space-y-1">
              <h4 className="font-medium text-sm capitalize">{formatFieldName(key)}</h4>
              <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1">
                {value.map((item: any, idx: number) => (
                  <li key={idx}>
                    {typeof item === 'object' ? JSON.stringify(item) : String(item)}
                  </li>
                ))}
              </ul>
            </div>
          );
        } else if (typeof value === 'object' && value !== null) {
          return (
            <div key={key} className="space-y-1">
              <h4 className="font-medium text-sm capitalize">{formatFieldName(key)}</h4>
              <pre className="text-xs text-muted-foreground bg-muted p-2 rounded overflow-x-auto">
                {JSON.stringify(value, null, 2)}
              </pre>
            </div>
          );
        } else {
          return (
            <div key={key} className="space-y-1">
              <h4 className="font-medium text-sm capitalize">{formatFieldName(key)}</h4>
              <p className="text-sm text-muted-foreground">{String(value)}</p>
            </div>
          );
        }
      });
  };

  return (
    <Tabs defaultValue="overview">
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="overview">
          <BookOpen className="w-4 h-4 mr-2" />
          全书概览
        </TabsTrigger>
        <TabsTrigger value="chapters">
          <FileText className="w-4 h-4 mr-2" />
          章节分析 ({chapters.length})
        </TabsTrigger>
      </TabsList>

      <TabsContent value="overview" className="space-y-4 mt-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Badge>{formatContentType(analysis.contentType)}</Badge>
          <span>使用 {analysis.model} 分析</span>
          <span>•</span>
          <span>{new Date(analysis.analyzedAt).toLocaleString()}</span>
        </div>

        <div className="space-y-4">
          {renderContentFields()}
        </div>
      </TabsContent>

      <TabsContent value="chapters" className="mt-4">
        {chapters.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-4">暂无章节分析</p>
        ) : (
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {chapters.map((chapter) => (
              <div key={chapter.chapterId} className="border rounded-lg p-3">
                <div className="flex items-start justify-between mb-2">
                  <h4 className="font-medium text-sm">
                    第 {chapter.chapterNumber} 章: {chapter.title}
                  </h4>
                </div>
                <p className="text-sm text-muted-foreground">{chapter.summary}</p>
                {Object.entries(chapter)
                  .filter(([key]) => !['chapterId', 'chapterNumber', 'title', 'summary', 'analyzedAt'].includes(key))
                  .map(([key, value]) => (
                    <div key={key} className="mt-2">
                      <span className="text-xs font-medium capitalize">{formatFieldName(key)}: </span>
                      <span className="text-xs text-muted-foreground">
                        {Array.isArray(value) ? value.join(', ') : String(value)}
                      </span>
                    </div>
                  ))}
              </div>
            ))}
          </div>
        )}
      </TabsContent>
    </Tabs>
  );
}

/**
 * 格式化字段名
 */
function formatFieldName(key: string): string {
  const fieldNames: Record<string, string> = {
    title: '标题',
    author: '作者',
    summary: '摘要',
    themes: '主题',
    characters: '人物',
    keyEvents: '关键事件',
    topics: '话题',
    keyConcepts: '核心概念',
    prerequisites: '前置知识',
    targetAudience: '目标读者',
    mainArgument: '核心论点',
    keyPoints: '关键点',
    conclusion: '结论',
    wordCount: '字数',
    chapterCount: '章节数',
    language: '语言',
  };
  return fieldNames[key] || key;
}

/**
 * 格式化内容类型
 */
function formatContentType(type: string): string {
  const types: Record<string, string> = {
    fiction: '小说',
    'non-fiction': '非虚构',
    article: '文章',
    reference: '参考书',
    other: '其他',
  };
  return types[type] || type;
}
