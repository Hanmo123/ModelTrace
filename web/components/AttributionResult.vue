<script setup lang="ts">
import { AlertCircle } from 'lucide-vue-next'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { AnalysisResult } from '@/lib/fingerprint'
import { percent } from '@/lib/format'

defineProps<{ result: AnalysisResult }>()

const diagnosisClass = (accepted: boolean) =>
  accepted
    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
    : 'border-amber-200 bg-amber-50 text-amber-700'
</script>

<template>
  <Card>
    <CardHeader>
      <CardTitle>归因结果</CardTitle>
    </CardHeader>
    <CardContent class="flex flex-col gap-5">
      <div class="grid grid-cols-2 gap-4 md:grid-cols-4">
        <div class="flex flex-col gap-1">
          <span class="text-xs text-muted-foreground">最可能模型</span>
          <strong class="text-lg leading-tight">{{ result.prediction_name }}</strong>
        </div>
        <div class="flex flex-col gap-1">
          <span class="text-xs text-muted-foreground">统一库概率</span>
          <strong class="text-lg leading-tight">{{ percent(result.probability) }}</strong>
        </div>
        <div class="flex flex-col gap-1">
          <span class="text-xs text-muted-foreground">模型家族</span>
          <strong class="text-lg leading-tight">
            {{ result.family_prediction_name }} · {{ percent(result.family_probability) }}
          </strong>
        </div>
        <div class="flex flex-col gap-1">
          <span class="text-xs text-muted-foreground">有效查询</span>
          <strong class="text-lg leading-tight">{{ result.used_outputs }}/3</strong>
        </div>
      </div>

      <div class="flex flex-wrap gap-2">
        <Badge
          v-for="item in result.diagnostics"
          :key="item.index"
          variant="outline"
          :class="diagnosisClass(item.accepted)"
        >
          挑战 {{ item.index + 1 }}：{{ item.parsed_numbers }} 个数字 ·
          {{ item.accepted ? '计入' : '忽略' }}
        </Badge>
      </div>

      <div class="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead class="w-14">排序</TableHead>
              <TableHead>候选模型</TableHead>
              <TableHead>家族</TableHead>
              <TableHead class="w-64">归因概率</TableHead>
              <TableHead class="w-28 text-right">分布相似度</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow
              v-for="(item, index) in result.results"
              :key="item.model"
              :class="{ 'bg-muted/50': index === 0 }"
            >
              <TableCell>{{ index + 1 }}</TableCell>
              <TableCell class="font-medium">{{ item.display_name }}</TableCell>
              <TableCell class="text-muted-foreground">{{ item.family_name }}</TableCell>
              <TableCell>
                <div class="flex items-center gap-2">
                  <div class="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      class="h-full rounded-full bg-primary"
                      :style="{ width: `${Math.max(item.probability * 100, 0.5)}%` }"
                    />
                  </div>
                  <span class="w-14 text-right text-sm font-medium">{{ percent(item.probability) }}</span>
                </div>
              </TableCell>
              <TableCell class="text-right text-muted-foreground">
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
