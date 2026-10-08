import { useState } from 'react';
import { Tags, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';

interface NoteMetaSectionProps {
  tags: string[];
  onTagsChange: (tags: string[]) => void;
}

export function NoteMetaSection({ tags, onTagsChange }: NoteMetaSectionProps) {
  const [tagDraft, setTagDraft] = useState('');

  const addTag = () => {
    const tag = tagDraft.trim();
    setTagDraft('');
    if (!tag || tags.includes(tag)) return;
    onTagsChange([...tags, tag]);
  };

  const removeTag = (tag: string) => {
    onTagsChange(tags.filter((t) => t !== tag));
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
    </div>
  );
}
