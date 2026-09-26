import { toast } from "vue-sonner";
import { createDegradationUnlock } from "../lib/degradation";

const STORAGE_KEY = "modeltrace.degradation-enabled.v1";

export function useDegradationUnlock(activate: () => void) {
  const unlocked = ref(false);
  const matcher = createDegradationUnlock();

  function persist(enabled: boolean) {
    try {
      if (enabled) localStorage.setItem(STORAGE_KEY, "true");
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      toast.warning(enabled
        ? "浏览器无法保存启用状态，刷新后可能关闭隐藏模式。"
        : "浏览器无法保存关闭状态，刷新后可能重新开启隐藏模式。");
    }
  }

  function disable() {
    unlocked.value = false;
    matcher.reset();
    persist(false);
  }

  function onKeydown(event: KeyboardEvent) {
    const target = event.target;
    // Never consume or collect typing in credentials, prompts or dialogs.
    if (
      event.isComposing || event.repeat || event.ctrlKey || event.metaKey || event.altKey ||
      (target instanceof HTMLElement && (
        target.isContentEditable ||
        target.closest('input, textarea, select, [role="textbox"], [role="combobox"], [role="listbox"], [role="dialog"], [role="alertdialog"]')
      ))
    ) {
      matcher.reset();
      return;
    }
    if (!matcher.push(event.key)) return;
    unlocked.value = true;
    persist(true);
    activate();
  }

  onMounted(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) === "true") {
        unlocked.value = true;
        activate();
      }
    } catch {
      // Default to hidden if browser storage cannot be read.
    }
    window.addEventListener("keydown", onKeydown, true);
  });
  onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown, true));
  return { unlocked, disable };
}
