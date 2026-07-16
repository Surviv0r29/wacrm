'use client'

import { PREBUILT_AGENTS } from '@/lib/ai/prebuilt-agents'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

export function PrebuiltAgentsOverview() {
  const agents = Object.values(PREBUILT_AGENTS)
  return (
    <div className="mb-6 grid gap-3 md:grid-cols-2">
      {agents.map((agent) => (
        <Card key={agent.slug}>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-sm text-foreground">{agent.name}</CardTitle>
              <Badge variant="outline" className="text-[10px]">
                Flash Lite
              </Badge>
            </div>
            <CardDescription className="text-xs">{agent.description}</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-[11px] text-muted-foreground line-clamp-3">
              Platform-trained prompt + shared knowledge pack. No custom
              fine-tune required — your Gemini key powers inference.
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
