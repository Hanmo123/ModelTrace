<script setup lang="ts">
import { AlertCircle } from 'lucide-vue-next'
import { Badge } from '@/components/ui/badge'
import type { AnalysisResult } from '@/lib/fingerprint'
import { familyTone } from '@/lib/family'
import { percent } from '@/lib/format'
import { cn } from '@/lib/utils'

defineProps<{ result: AnalysisResult }>()

const diagnosisClass = (accepted: boolean) =>
  accepted
    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
    : 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400'
</script>

<template>
  <div class="flex flex-col gap-5">
    <!-- 判定：大写模型名 + 大字号概率 -->
    <div class="flex flex-col gap-3">
      <span class="text-xs font-medium uppercase tracking-widest text-muted-foreground">
        最可能模型
      </span>
      <h2 class="break-all text-3xl font-extrabold uppercase leading-none tracking-tight">
        {{ result.prediction_name }}
      </h2>
      <div class="flex items-center gap-2">
        <Badge variant="outline" :class="cn('font-normal', familyTone(result.family_prediction).chip)">
          {{ result.family_prediction_name }} 家族 · {{ percent(result.family_probability) }}
        </Badge>
        <span class="tnum text-xs text-muted-foreground">有效查询 {{ result.used_outputs }}/3</span>
      </div>
      <strong class="tnum text-6xl font-extrabold leading-none tracking-tight">
        {{ percent(result.probability) }}
      </strong>
    </div>

    <!-- 挑战诊断 -->
    <div class="flex flex-wrap gap-1.5">
      <Badge
        v-for="item in result.diagnostics"
        :key="item.index"
        variant="outline"
        :class="cn('font-normal', diagnosisClass(item.accepted))"
      >
        挑战 {{ item.index + 1 }}：{{ item.parsed_numbers }} 个数字 ·
        {{ item.accepted ? '计入' : '忽略' }}
      </Badge>
    </div>

    <!-- 分布柱状图 -->
    <div class="flex flex-col gap-2">
      <span class="text-xs font-medium uppercase tracking-widest text-muted-foreground">
        候选分布
      </span>
      <ProbBarChart :results="result.results" />
    </div>

    <p class="flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
      <AlertCircle class="mt-0.5 size-3.5 shrink-0" />
      仅对指纹库内的模型进行归因；待测模型不在库中时，任何结果都有可能。Claude Code
      的系统提示词会显著影响偏好，不建议在其中测试。
    </p>
  </div>
</template>
