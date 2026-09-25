<script setup lang="ts">
import { AlertCircle, Trophy } from 'lucide-vue-next'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { AnalysisResult } from '@/lib/fingerprint'
import { familyTone } from '@/lib/family'
import { percent } from '@/lib/format'
import { cn } from '@/lib/utils'

const props = defineProps<{ result: AnalysisResult }>()

const diagnosisClass = (accepted: boolean) =>
  accepted
    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
    : 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400'

const topTone = computed(() => familyTone(props.result.family_prediction))
</script>

<template>
  <Card class="overflow-hidden">
    <div class="verdict-glow h-1" aria-hidden="true" />
    <CardContent class="flex flex-col gap-6 p-6">
      <!-- 判定摘要 -->
      <div class="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
        <div class="flex flex-col gap-2">
          <span class="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            最可能模型
          </span>
          <div class="flex items-center gap-3">
            <span :class="cn('size-3 shrink-0 rounded-full', topTone.dot)" aria-hidden="true" />
            <strong class="text-2xl font-bold tracking-tight sm:text-3xl">
              {{ result.prediction_name }}
            </strong>
          </div>
          <Badge variant="outline" :class="cn('w-fit font-normal', topTone.chip)">
            {{ result.family_prediction_name }} 家族 · {{ percent(result.family_probability) }}
          </Badge>
        </div>
        <div class="flex items-baseline gap-2 sm:flex-col sm:items-end sm:gap-0">
          <strong class="tnum text-4xl font-bold tracking-tight text-primary sm:text-5xl">
            {{ percent(result.probability) }}
          </strong>
          <span class="text-xs text-muted-foreground">统一库概率</span>
        </div>
      </div>

      <!-- 次要指标 -->
      <div class="grid grid-cols-3 gap-4 rounded-lg border bg-muted/40 p-4">
        <div class="flex flex-col gap-0.5">
          <span class="text-xs text-muted-foreground">有效查询</span>
          <strong class="tnum text-lg">{{ result.used_outputs }}/3</strong>
        </div>
        <div class="flex flex-col gap-0.5">
          <span class="text-xs text-muted-foreground">校准温度 β</span>
          <strong class="tnum text-lg">{{ result.calibration.beta.toFixed(2) }}</strong>
        </div>
        <div class="flex flex-col gap-0.5">
          <span class="text-xs text-muted-foreground">交叉验证准确率</span>
          <strong class="tnum text-lg">{{ percent(result.calibration.cv_accuracy) }}</strong>
        </div>
      </div>

      <!-- 挑战诊断 -->
      <div class="flex flex-wrap gap-2">
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

      <!-- 候选排行 -->
      <div class="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow class="bg-muted/40 hover:bg-muted/40">
              <TableHead class="w-12">#</TableHead>
              <TableHead>候选模型</TableHead>
              <TableHead class="hidden sm:table-cell">家族</TableHead>
              <TableHead class="w-56">归因概率</TableHead>
              <TableHead class="hidden w-24 text-right md:table-cell">分布相似度</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow
              v-for="(item, index) in result.results"
              :key="item.model"
              :class="{ 'bg-primary/5': index === 0 }"
            >
              <TableCell>
                <Trophy v-if="index === 0" class="size-4 text-amber-500" aria-label="最佳匹配" />
                <span v-else class="tnum text-muted-foreground">{{ index + 1 }}</span>
              </TableCell>
              <TableCell :class="cn('font-medium', index === 0 && 'text-primary')">
                {{ item.display_name }}
              </TableCell>
              <TableCell class="hidden sm:table-cell">
                <span class="flex items-center gap-1.5 text-muted-foreground">
                  <span :class="cn('size-1.5 rounded-full', familyTone(item.family).dot)" />
                  {{ item.family_name }}
                </span>
              </TableCell>
              <TableCell>
                <div class="flex items-center gap-2">
                  <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      class="h-full rounded-full bg-gradient-to-r from-primary to-sky-500 transition-[width] duration-500"
                      :style="{ width: `${Math.max(item.probability * 100, 1)}%` }"
                    />
                  </div>
                  <span class="tnum w-14 text-right text-sm font-medium">
                    {{ percent(item.probability) }}
                  </span>
                </div>
              </TableCell>
              <TableCell class="tnum hidden text-right text-muted-foreground md:table-cell">
                {{ percent(item.profile_similarity) }}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>

      <Alert>
        <AlertCircle class="size-4" />
        <AlertTitle>结果说明</AlertTitle>
        <AlertDescription class="flex flex-col gap-1">
          <p>本工具仅对指纹库内的模型进行归因；若待测模型不在指纹库中，得到任何结果都有可能。</p>
          <p>Claude Code 的系统提示词会影响模型偏好，测试结果存在较大偏差，建议不要在 Claude Code 中测试。</p>
        </AlertDescription>
      </Alert>
    </CardContent>
  </Card>
</template>
