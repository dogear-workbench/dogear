[Console]::InputEncoding = [Text.Encoding]::UTF8
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$RTK_TOOLS = @(
  'git', 'gh', 'pnpm', 'npm', 'npx', 'yarn', 'bun',
  'cargo', 'tsc', 'jest', 'vitest', 'playwright', 'pytest', 'rspec', 'prisma',
  'prettier', 'eslint', 'next', 'docker', 'kubectl', 'curl', 'wget',
  'ls', 'grep', 'find'
)

try {
  $stdin = [Console]::In.ReadToEnd()
  if (-not $stdin) { exit 0 }

  $payload = $stdin | ConvertFrom-Json
  if ($payload.tool_name -ne 'Bash') { exit 0 }

  $command = $payload.tool_input.command
  if (-not $command) { exit 0 }

  $rtkPath = Get-Command rtk -ErrorAction SilentlyContinue
  if (-not $rtkPath) {
    [Console]::Error.WriteLine('[rtk-rewrite] rtk.exe not found, skipping')
    exit 0
  }

  # 按 && || ; | 拆分，保留分隔符
  $segments = [regex]::Split($command, '(\s*(?:&&|\|\||;|\|)\s*)')
  $changed = $false

  for ($i = 0; $i -lt $segments.Length; $i += 2) {
    $seg = $segments[$i]
    if (-not $seg) { continue }
    $trimmed = $seg.TrimStart()
    if (-not $trimmed) { continue }

    $firstToken = ($trimmed -split '\s+', 2)[0]
    if ($firstToken -eq 'rtk') { continue }
    if ($RTK_TOOLS -notcontains $firstToken) { continue }

    $leadingWs = $seg.Substring(0, $seg.Length - $trimmed.Length)
    $segments[$i] = $leadingWs + 'rtk ' + $trimmed
    $changed = $true
  }

  if (-not $changed) { exit 0 }

  $newCommand = -join $segments

  $output = @{
    hookSpecificOutput = @{
      hookEventName      = 'PreToolUse'
      permissionDecision = 'allow'
      updatedInput       = @{
        command = $newCommand
      }
    }
  }

  $output | ConvertTo-Json -Depth 10 -Compress
  exit 0
}
catch {
  [Console]::Error.WriteLine("[rtk-rewrite] error: $_")
  exit 0
}
