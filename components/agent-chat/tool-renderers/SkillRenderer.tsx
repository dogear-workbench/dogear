import { ToolDetailShell, ToolSection, KeyValueList, OutputBox } from './ToolDetailShell';

interface Props {
  toolInput?: Record<string, any>;
  toolOutput?: any;
  isError?: boolean;
}

export function SkillRenderer({ toolInput, toolOutput, isError }: Props) {
  const skillName: string = toolInput?.skill ?? '未知 Skill';
  const argsText: string = toolInput?.args ?? '';

  const outputText =
    typeof toolOutput === 'string'
      ? toolOutput
      : toolOutput != null
        ? JSON.stringify(toolOutput, null, 2)
        : '';

  const data: Record<string, string> = { skill: skillName };
  if (argsText) data.args = argsText;

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
