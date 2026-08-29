import { useState } from 'react';
import { Link2, Plus, Tags, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const LINK_PREFIXES = [
  { value: 'article', label: 'article', placeholder: '文章 ID，回车添加' },
  { value: 'stock', label: 'stock', placeholder: '股票代码，回车添加' },
  { value: 'plan', label: 'plan', placeholder: '计划文件路径，回车添加' },
] as const;

type LinkPrefix = (typeof LINK_PREFIXES)[number]['value'];

function splitLink(link: string): { prefix: string; value: string } {
  const i = link.indexOf(':');
  return { prefix: link.slice(0, i), value: link.slice(i + 1) };
}

interface NoteMetaSectionProps {
  tags: string[];
  links: string[];
  onTagsChange: (tags: string[]) => void;
  onLinksChange: (links: string[]) => void;
}

export function NoteMetaSection({ tags, links, onTagsChange, onLinksChange }: NoteMetaSectionProps) {
  const [tagDraft, setTagDraft] = useState('');
  const [linkPrefix, setLinkPrefix] = useState<LinkPrefix>('article');
  const [linkDraft, setLinkDraft] = useState('');

  const linkPlaceholder = LINK_PREFIXES.find((p) => p.value === linkPrefix)?.placeholder ?? '';

  const addTag = () => {
    const tag = tagDraft.trim();
    setTagDraft('');
    if (!tag || tags.includes(tag)) return;
    onTagsChange([...tags, tag]);
  };

  const removeTag = (tag: string) => {
    onTagsChange(tags.filter((t) => t !== tag));
  };

  const addLink = () => {
    const value = linkDraft.trim();
    setLinkDraft('');
    if (!value) return;
    const link = `${linkPrefix}:${value}`;
    if (links.includes(link)) return;
    onLinksChange([...links, link]);
  };

  const removeLink = (link: string) => {
    onLinksChange(links.filter((l) => l !== link));
  };

  return (
    <div className="mt-2 space-y-1.5 rounded-md border bg-muted/20 px-3 py-2.5">
      <div className="flex items-center gap-1.5 flex-wrap min-h-7">
        <Tags className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        {tags.map((tag) => (
          <Badge key={tag} variant="subtle" className="gap-1 pl-2 pr-1 py-0 font-normal">
            {tag}
            <button
              onClick={() => removeTag(tag)}
              className="rounded-full hover:bg-foreground/10 p-0.5"
              title="删除标签"
            >
              <X className="w-3 h-3" />
            </button>
          </Badge>
        ))}
        <Input
          value={tagDraft}
          onChange={(e) => setTagDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') addTag();
          }}
          placeholder="加标签"
          className="h-7 w-28 border-none bg-transparent px-1 text-xs shadow-none md:text-xs focus-visible:ring-0"
        />
      </div>
      <div className="flex items-center gap-1.5 flex-wrap min-h-7">
        <Link2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        {links.map((link) => {
          const { prefix, value } = splitLink(link);
          return (
            <Badge key={link} variant="outline" className="gap-1 pl-2 pr-1 py-0 font-normal max-w-64">
              <span className="text-[10px] text-muted-foreground shrink-0">{prefix}</span>
              <span className="truncate" title={value}>
                {value}
              </span>
              <button
                onClick={() => removeLink(link)}
                className="rounded-full hover:bg-foreground/10 p-0.5 shrink-0"
                title="删除链接"
              >
                <X className="w-3 h-3" />
              </button>
            </Badge>
          );
        })}
        <Select value={linkPrefix} onValueChange={(v) => setLinkPrefix(v as LinkPrefix)}>
          <SelectTrigger size="sm" className="h-7 w-[4.5rem] px-2 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LINK_PREFIXES.map((p) => (
              <SelectItem key={p.value} value={p.value} className="text-xs">
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          value={linkDraft}
          onChange={(e) => setLinkDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') addLink();
          }}
          placeholder={linkPlaceholder}
          className="h-7 w-44 text-xs md:text-xs"
        />
        <Button variant="ghost" size="icon-xs" onClick={addLink} title="添加链接">
          <Plus className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
}
