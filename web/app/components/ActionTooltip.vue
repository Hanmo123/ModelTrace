<script setup lang="ts">
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

defineProps<{ text: string; disabled?: boolean }>();
</script>

<template>
  <Tooltip :delay-duration="0">
    <TooltipTrigger as-child>
      <!-- Disabled native buttons cannot receive pointer/focus events. -->
      <span
        v-if="disabled"
        class="inline-flex max-w-full"
        tabindex="0"
        role="group"
        :aria-label="text"
      ><slot /></span>
      <slot v-else />
    </TooltipTrigger>
    <TooltipContent :aria-label="text">{{ text }}</TooltipContent>
  </Tooltip>
</template>
