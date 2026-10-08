import { ToolDetailShell, ToolSection, KeyValueList, OutputBox } from './ToolDetailShell';

interface Props {
  toolInput?: Record<string, any>;
  toolOutput?: any;
  isError?: boolean;
}

export function SkillRenderer({ toolInput, toolOutput, isError }: Props) {
  // pi 的 Skill 工具参数是 name，旧 SDK 会话历史是 skill
  const skillName: string = toolInput?.name ?? toolInput?.skill ?? '未知 Skill';

  const outputText =
    typeof toolOutput === 'string'
      ? toolOutput
      : toolOutput != null
        ? JSON.stringify(toolOutput, null, 2)
        : '';

  const data: Record<string, string> = { skill: skillName };

  return (
    <ToolDetailShell>
      <ToolSection label="调用">
        <KeyValueList data={data} />
      </ToolSection>
      {outputText && (
        <ToolSection label={isError ? '错误' : '输出'}>
          <OutputBox content={outputText} isError={isError} maxHeightClass="max-h-96" />
        </ToolSection>
      )}
    </ToolDetailShell>
  );
}
