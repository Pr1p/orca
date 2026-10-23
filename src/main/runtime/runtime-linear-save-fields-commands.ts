import { createRequire } from 'node:module'
import type { Nodes, Root } from 'mdast'
import type * as remarkGfmModule from 'remark-gfm'
import type * as remarkParseModule from 'remark-parse'
import type * as unifiedModule from 'unified'
import {
  type getLinearIssueByUuidForAgent,
  type LinearIssueUpdate,
  type LinearCreateFieldIntent,
  sameStringSet
} from './runtime-linear-command-dependencies'
import { linearError } from '../linear/issue-context/errors'
import { RuntimeLinearTaskFieldCommands } from './runtime-linear-task-fields-commands'

const requireFromRuntime = createRequire(__filename)
let markdown: { parse(description: string): Root } | undefined

function linearIssueDescriptionComparisonKey(description: string): string {
  if (!markdown) {
    const { unified }: typeof unifiedModule = requireFromRuntime('unified')
    const { default: remarkParse }: typeof remarkParseModule = requireFromRuntime('remark-parse')
    const { default: remarkGfm }: typeof remarkGfmModule = requireFromRuntime('remark-gfm')
    markdown = unified().use(remarkParse).use(remarkGfm)
  }
  const replacements = new Map<number, string>()
  const structure: string[] = []
  const pending: Nodes[] = [markdown.parse(description)]
  while (pending.length > 0) {
    const node = pending.pop()
    if (!node) {
      continue
    }
    structure.push(`${node.type}:${'children' in node ? node.children.length : 0}`)
    if (node.type === 'list' && !node.ordered) {
      for (const item of node.children) {
        const offset = item.position?.start.offset
        if (offset === undefined) {
          continue
        }
        const source = description.slice(offset, item.position?.end.offset)
        if (!/^[-*] (?=\S)/.test(source)) {
          continue
        }
        replacements.set(offset, '*')
        const taskNumber = /^[-*] \[[ xX]\] \d+(\\)\.(?=\s)/.exec(source)
        if (item.checked !== null && item.checked !== undefined && taskNumber) {
          replacements.set(offset + taskNumber[0].length - 2, '')
        }
      }
    }
    if ('children' in node) {
      pending.push(...node.children)
    }
  }
  // Preserve block structure too: changing list markers can join or separate adjacent lists.
  return JSON.stringify([
    description.replace(/[-*\\]/g, (character, offset) => replacements.get(offset) ?? character),
    structure
  ])
}

export class RuntimeLinearSaveFieldCommands extends RuntimeLinearTaskFieldCommands {
  public linearSavedIssueMatchesIntent(
    issue: NonNullable<Awaited<ReturnType<typeof getLinearIssueByUuidForAgent>>>,
    fields: LinearIssueUpdate
  ): boolean {
    if (fields.title !== undefined && issue.title !== fields.title) {
      return false
    }
    if (
      fields.description !== undefined &&
      (issue.description ?? '') !== fields.description &&
      linearIssueDescriptionComparisonKey(issue.description ?? '') !==
        linearIssueDescriptionComparisonKey(fields.description)
    ) {
      return false
    }
    if (fields.parentId !== undefined && (issue.parent?.id ?? null) !== fields.parentId) {
      return false
    }
    if (fields.stateId !== undefined && issue.state?.id !== fields.stateId) {
      return false
    }
    if (fields.assigneeId !== undefined && (issue.assignee?.id ?? null) !== fields.assigneeId) {
      return false
    }
    if (fields.priority !== undefined && issue.priority !== fields.priority) {
      return false
    }
    if (fields.estimate !== undefined && (issue.estimate ?? null) !== fields.estimate) {
      return false
    }
    if (fields.dueDate !== undefined && (issue.dueDate ?? null) !== fields.dueDate) {
      return false
    }
    if (fields.projectId !== undefined && (issue.project?.id ?? null) !== fields.projectId) {
      return false
    }
    const issueLabelIds = issue.labelIds ?? issue.labels?.map((label) => label.id) ?? []
    return fields.labelIds === undefined || sameStringSet(issueLabelIds, fields.labelIds)
  }

  public async resolveLinearCreateFields(
    params: {
      state?: string
      assignee?: string
      priority?: number
      estimate?: number
      dueDate?: string
      labels?: string[]
      projectInput?: string
    },
    team: { id: string; workspaceId: string }
  ): Promise<LinearCreateFieldIntent> {
    const fields: LinearCreateFieldIntent = {}
    if (params.state) {
      const states = await this.getLinearTeamStatesForWrite(team.id, team.workspaceId)
      const state = this.resolveLinearAgentState(params.state, states)
      if (!state) {
        throw linearError(
          'linear_invalid_state',
          `No workflow state exactly matched "${params.state}".`,
          { states: states.map(({ id, name, type }) => ({ id, name, type })) }
        )
      }
      fields.stateId = state.id
    }
    if (params.assignee) {
      fields.assigneeId = await this.resolveLinearAssignee(
        params.assignee,
        team.id,
        team.workspaceId
      )
    }
    if (params.priority !== undefined) {
      fields.priority = params.priority
    }
    if (params.estimate !== undefined) {
      fields.estimate = params.estimate
    }
    if (params.dueDate !== undefined) {
      fields.dueDate = params.dueDate
    }
    if (params.labels && params.labels.length > 0) {
      const labels = await this.resolveLinearLabelsForTeam(team.id, params.labels, team.workspaceId)
      fields.labelIds = labels.map((label) => label.id)
    }
    if (params.projectInput) {
      const project = await this.resolveLinearCreateProject(params.projectInput, team)
      fields.projectId = project.id
    }
    return fields
  }
}
