<script setup lang="ts">
import type { TooltipContentEmits, TooltipContentProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { reactiveOmit } from "@vueuse/core"
import { TooltipContent, TooltipPortal, useForwardPropsEmits } from "reka-ui"
import { cn } from "@/lib/utils"

defineOptions({ inheritAttrs: false })
const props = withDefaults(defineProps<TooltipContentProps & { class?: HTMLAttributes["class"] }>(), {
  sideOffset: 4,
})
const emits = defineEmits<TooltipContentEmits>()
const forwarded = useForwardPropsEmits(reactiveOmit(props, "class"), emits)
</script>

<template>
  <TooltipPortal>
    <TooltipContent
      data-slot="tooltip-content"
      v-bind="{ ...forwarded, ...$attrs }"
      :class="cn('z-50 max-w-xs break-words rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground shadow-md', props.class)"
    >
      <slot />
    </TooltipContent>
  </TooltipPortal>
</template>
