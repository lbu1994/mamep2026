using System.Text.Json;
using System.Text.RegularExpressions;
using FlaUI.Core.AutomationElements;
using FlaUI.Core.AutomationElements.PatternElements;
using FlaUI.Core.Definitions;
using FlaUI.UIA3;

var options = AgentOptions.Parse(args);
using var automation = new UIA3Automation();
var desktop = automation.GetDesktop();

AutomationElement? root = null;
var deadline = DateTime.UtcNow + options.Timeout;

while (DateTime.UtcNow < deadline && root is null)
{
    root = desktop
        .FindAllChildren()
        .FirstOrDefault(candidate =>
            candidate.ControlType == ControlType.Window &&
            (options.ProcessId is null ||
                Safe(() => candidate.FrameworkAutomationElement.ProcessId) ==
                    options.ProcessId) &&
            (options.TitlePattern is null ||
                options.TitlePattern.IsMatch(
                    Safe(() => candidate.Name) ?? string.Empty)));

    if (root is null)
    {
        Thread.Sleep(250);
    }
}

if (root is null)
{
    Console.Error.WriteLine(
        $"No matching Edge window found within {options.Timeout.TotalSeconds:0}s.");
    return 2;
}

if (options.Dump)
{
    var nodes = CollectNodes(root, options.PortPattern);
    var payload = new
    {
        window = Describe(root),
        nodes,
    };
    var json = JsonSerializer.Serialize(payload, new JsonSerializerOptions
    {
        WriteIndented = true,
    });
    if (options.OutputPath is null)
    {
        Console.WriteLine(json);
    }
    else
    {
        File.WriteAllText(options.OutputPath, json);
        Console.WriteLine(options.OutputPath);
    }
}

if (options.Select || options.ConfirmOnly)
{
    AutomationElement? target = null;
    if (options.Select)
    {
        while (DateTime.UtcNow < deadline && target is null)
        {
            target = FindPortTarget(root, options.PortPattern);
            if (target is null)
            {
                Thread.Sleep(250);
            }
        }

        if (target is null)
        {
            Console.Error.WriteLine(
                $"No selectable UIA element matching {options.PortPattern} was found.");
            return 3;
        }

        var selectionItem = target.Patterns.SelectionItem.PatternOrDefault;
        if (selectionItem is not null)
        {
            new SelectionItemAutomationElement(target.FrameworkAutomationElement).Select();
        }
        else
        {
            target.Click();
        }
    }

    var confirmTarget = WaitForConfirmTarget(root, options.ConfirmPattern, deadline);
    if (confirmTarget is null)
    {
        Console.Error.WriteLine(
            $"Port {options.PortPattern} was selected but no enabled chooser confirmation button appeared.");
        return 4;
    }

    // Chromium 的 MdTextButton 暴露 InvokePattern，但 UIA Invoke 不一定驱动真实按钮动作；
    // 使用 FlaUI 的中心点点击，让 Edge 收到与用户点击一致的输入事件。
    confirmTarget.Click();

    Console.WriteLine(
        $"Selected: {(target is null ? "(existing selection)" : Describe(target).Name)}; "
        + $"confirmed: {Describe(confirmTarget).Name}");
}

return 0;

static AutomationElement? FindPortTarget(
    AutomationElement root,
    Regex portPattern)
{
    return root
        .FindAllDescendants()
        .Where(candidate =>
            !Safe(() => candidate.IsOffscreen) &&
            Safe(() => candidate.IsEnabled) &&
            portPattern.IsMatch(Safe(() => candidate.Name) ?? string.Empty))
        .OrderBy(candidate =>
            candidate.ControlType == ControlType.ListItem ? 0 :
            candidate.ControlType == ControlType.DataItem ? 1 :
            Safe(() => candidate.Patterns.SelectionItem.IsSupported) ? 2 :
            Safe(() => candidate.Patterns.Invoke.IsSupported) ? 3 :
            4)
        .FirstOrDefault();
}

static AutomationElement? WaitForConfirmTarget(
    AutomationElement root,
    Regex confirmPattern,
    DateTime deadline)
{
    while (DateTime.UtcNow < deadline)
    {
        var target = root
            .FindAllDescendants()
            .FirstOrDefault(candidate =>
                candidate.ControlType == ControlType.Button &&
                Safe(() => candidate.IsEnabled) &&
                !Safe(() => candidate.IsOffscreen) &&
                (Safe(() => candidate.ClassName) ?? string.Empty)
                    .Contains("MdTextButton", StringComparison.Ordinal) &&
                confirmPattern.IsMatch(Safe(() => candidate.Name) ?? string.Empty));
        if (target is not null)
        {
            return target;
        }

        Thread.Sleep(100);
    }

    return null;
}

static object[] CollectNodes(
    AutomationElement root,
    Regex highlightedPattern)
{
    var nodes = new List<object>();
    foreach (var element in root.FindAllDescendants().Take(4000))
    {
        var description = Describe(element);
        if (highlightedPattern.IsMatch(
                $"{description.Name} {description.ClassName}"))
        {
            nodes.Add(new
            {
                description,
                highlighted = true,
            });
        }
        else
        {
            nodes.Add(description);
        }
    }

    return nodes.ToArray();
}

static ElementDescription Describe(AutomationElement element)
{
    var patterns = new[]
        {
            ("Invoke", element.Patterns.Invoke.IsSupported),
            ("SelectionItem", element.Patterns.SelectionItem.IsSupported),
            ("Toggle", element.Patterns.Toggle.IsSupported),
            ("Value", element.Patterns.Value.IsSupported),
            ("ExpandCollapse", element.Patterns.ExpandCollapse.IsSupported),
            ("ScrollItem", element.Patterns.ScrollItem.IsSupported),
            ("Text", element.Patterns.Text.IsSupported),
        }
        .Where(pattern => pattern.Item2)
        .Select(pattern => pattern.Item1)
        .ToArray();

    return new ElementDescription(
        Safe(() => element.ControlType.ToString()),
        Safe(() => element.Name) ?? string.Empty,
        Safe(() => element.AutomationId) ?? string.Empty,
        Safe(() => element.ClassName) ?? string.Empty,
        Safe(() => element.FrameworkType.ToString()),
        Safe(() => element.IsEnabled),
        Safe(() => element.IsOffscreen),
        patterns);
}

static T Safe<T>(Func<T> read)
{
    try
    {
        return read();
    }
    catch
    {
        return default!;
    }
}

internal sealed record ElementDescription(
    string ControlType,
    string Name,
    string AutomationId,
    string ClassName,
    string FrameworkType,
    bool IsEnabled,
    bool IsOffscreen,
    string[] Patterns);

internal sealed class AgentOptions
{
    public int? ProcessId { get; init; }
    public required Regex PortPattern { get; init; }
    public required Regex ConfirmPattern { get; init; }
    public Regex? TitlePattern { get; init; }
    public TimeSpan Timeout { get; init; } = TimeSpan.FromSeconds(30);
    public bool Dump { get; init; }
    public bool Select { get; init; }
    public bool ConfirmOnly { get; init; }
    public string? OutputPath { get; init; }

    public static AgentOptions Parse(string[] args)
    {
        var values = new Dictionary<string, string>(StringComparer.Ordinal);
        var flags = new HashSet<string>(StringComparer.Ordinal);
        for (var index = 0; index < args.Length; index += 1)
        {
            var argument = args[index];
            if (!argument.StartsWith("--", StringComparison.Ordinal))
            {
                throw new ArgumentException($"Unexpected argument: {argument}");
            }

            if (argument is "--dump" or "--select" or "--confirm-only")
            {
                flags.Add(argument);
                continue;
            }

            if (index + 1 >= args.Length)
            {
                throw new ArgumentException($"Missing value for {argument}");
            }

            values[argument] = args[++index];
        }

        int? processId = null;
        if (values.TryGetValue("--pid", out var pidText))
        {
            if (!int.TryParse(pidText, out var parsedProcessId))
            {
                throw new ArgumentException("--pid must be an integer.");
            }
            processId = parsedProcessId;
        }

        var port = values.GetValueOrDefault("--port", "COM4");
        var title = values.GetValueOrDefault("--title-regex");
        var timeoutText = values.GetValueOrDefault("--timeout-ms", "30000");
        if (!int.TryParse(timeoutText, out var timeoutMs) || timeoutMs <= 0)
        {
            throw new ArgumentException("--timeout-ms must be positive.");
        }
        if (processId is null && title is null)
        {
            throw new ArgumentException("Provide --pid and/or --title.");
        }

        return new AgentOptions
        {
            ProcessId = processId,
            PortPattern = new Regex(
                $@"(^|[\s(]){Regex.Escape(port)}($|[\s)])",
                RegexOptions.IgnoreCase | RegexOptions.CultureInvariant),
            ConfirmPattern = new Regex(
                values.GetValueOrDefault("--confirm-regex", "^(Connect|连接)$"),
                RegexOptions.IgnoreCase | RegexOptions.CultureInvariant),
            TitlePattern = title is null
                ? null
                : new Regex(title, RegexOptions.IgnoreCase | RegexOptions.CultureInvariant),
            Timeout = TimeSpan.FromMilliseconds(timeoutMs),
            Dump = flags.Contains("--dump"),
            Select = flags.Contains("--select"),
            ConfirmOnly = flags.Contains("--confirm-only"),
            OutputPath = values.GetValueOrDefault("--output"),
        };
    }
}
