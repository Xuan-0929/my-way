/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')
const cssWithoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '')

const ruleFor = (selector: string): string => [...cssWithoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .filter((match) => match[1].split(',').map((part) => part.trim()).includes(selector))
  .map((match) => match[2])
  .join('\n')

const variableColors = (name: string): string[] => [
  ...css.matchAll(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, 'gi'))
].map((match) => match[1])

const luminance = (hex: string): number => {
  const channels = hex.slice(1).match(/../g)?.map((value) => Number.parseInt(value, 16) / 255) ?? []
  const linear = channels.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
  return (0.2126 * linear[0]) + (0.7152 * linear[1]) + (0.0722 * linear[2])
}

const contrast = (foreground: string, background: string): number => {
  const foregroundLuminance = luminance(foreground)
  const backgroundLuminance = luminance(background)
  return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05)
    / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
}

describe('simplified UI stylesheet contract', () => {
  it('uses a readable error color in both color schemes', () => {
    const errors = variableColors('danger')
    const papers = variableColors('paper')
    expect(errors).toHaveLength(2)
    for (const index of [0, 1]) expect(contrast(errors[index], papers[index])).toBeGreaterThanOrEqual(4.5)
    expect(ruleFor('.minute-field-error')).toContain('var(--danger)')
  })
  it('keeps daily calendar buttons on the same flat surface as weekly cards', () => {
    const rule = ruleFor('.calendar-record-task')
    expect(rule).toMatch(/appearance:\s*none/)
    expect(rule).toMatch(/border-top:\s*0/)
    expect(rule).toMatch(/border-right:\s*0/)
    expect(rule).toMatch(/border-bottom:\s*0/)
  })
  it('keeps the fullscreen exit above application dialogs and out of drag regions', () => {
    const controls = ruleFor('.fullscreen-controls')
    const layer = (rule: string) => Number(/z-index:\s*(\d+)/.exec(rule)?.[1])
    expect(layer(controls)).toBeGreaterThan(layer(ruleFor('.modal-backdrop')))
    expect(controls).toMatch(/-webkit-app-region:\s*no-drag/)
  })
  it('uses the macOS system interface stack without display serifs', () => {
    expect(css).toContain('--font-ui: -apple-system')
    expect(css).not.toMatch(/Georgia|Songti SC/)
    expect(css).not.toContain('text-transform: uppercase')
  })

  it.each(['.category-mark', '.status-mark', '.save-dot', '.timer-sidebar-status i'])('%s is constrained to a square before rounding', (selector) => {
    const rule = ruleFor(selector)
    expect(rule).toMatch(/aspect-ratio:\s*1\s*\/\s*1/)
    expect(rule).toMatch(/border-radius:\s*50%/)
  })

  it('keeps the completion ring in a square containing box', () => {
    expect(ruleFor('.completion-ring')).toMatch(/aspect-ratio:\s*1\s*\/\s*1/)
  })

  it.each(['.week-workspace', '.week-budget', '.week-plan-row', '.previous-task-row'])('defines a restrained %s surface', (selector) => {
    const rule = ruleFor(selector)
    expect(rule).not.toBe('')
    expect(rule).not.toMatch(/gradient|text-shadow|filter:|text-transform:\s*uppercase/)
    const radii = [...rule.matchAll(/border-radius:\s*(\d+)px/g)].map((match) => Number(match[1]))
    expect(radii.every((radius) => radius <= 18)).toBe(true)
  })

  it('keeps weekly controls aligned and adapts the task grid at 1280px', () => {
    expect(ruleFor('.week-plan-row')).toMatch(/grid-template-columns/)
    expect(ruleFor('.week-plan-row input')).toMatch(/min-height:\s*34px/)
    expect(ruleFor('.week-task-actions')).toMatch(/minmax\(40px,\s*1fr\)/)
    expect(css).toMatch(/@media\s*\(max-width:\s*1280px\)[\s\S]*?\.week-plan-row/)
  })

  it('keeps the past-exam save action visibly primary inside its dialog', () => {
    const rule = ruleFor('.past-exam-dialog-actions .primary-button')
    expect(rule).toMatch(/background:\s*var\(--indigo\)/)
    expect(rule).toMatch(/color:\s*var\(--on-accent\)/)
  })

  it.each([
    '.past-exam-dialog input[aria-invalid="true"]',
    '.timer-assignment-dialog input[aria-invalid="true"]',
    '.timer-assignment-dialog select[aria-invalid="true"]'
  ])('shows a consistent invalid-field boundary for %s', (selector) => {
    expect(ruleFor(selector)).toMatch(/border-color:\s*rgba\(150,\s*92,\s*88,\s*\.62\)/)
  })

  it('keeps secondary text readable on the paper surface in both color schemes', () => {
    const papers = variableColors('paper')
    const muted = variableColors('muted')
    const faint = variableColors('faint')

    expect(papers).toHaveLength(2)
    expect(muted).toHaveLength(2)
    expect(faint).toHaveLength(2)
    for (const index of [0, 1]) {
      expect(contrast(muted[index], papers[index])).toBeGreaterThanOrEqual(4.5)
      expect(contrast(faint[index], papers[index])).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('gives fitness a restrained category treatment in light and dark themes', () => {
    expect(variableColors('fitness')).toHaveLength(2)
    expect(ruleFor('.category-mark.fitness')).toMatch(/color:\s*var\(--fitness\)/)
    expect(ruleFor('.calendar-task.fitness')).toMatch(/border-color:\s*var\(--fitness\)/)
    expect(css).toMatch(/@media\s*\(prefers-color-scheme:\s*dark\)[\s\S]*?\.category-mark\.fitness/)
  })

  it('uses readable solid accent buttons in both themes', () => {
    const accents = variableColors('accent')
    const foregrounds = variableColors('on-accent')
    expect(accents).toHaveLength(2)
    expect(foregrounds).toHaveLength(2)
    for (const index of [0, 1]) expect(contrast(accents[index], foregrounds[index])).toBeGreaterThanOrEqual(4.5)
  })

  it('keeps secondary and fitness text readable on the actual tinted surfaces', () => {
    for (const surface of ['paper', 'desk', 'surface', 'surface-hover', 'accent-soft']) {
      for (const index of [0, 1]) expect(contrast(variableColors('muted')[index], variableColors(surface)[index])).toBeGreaterThanOrEqual(4.5)
    }
    for (const index of [0, 1]) expect(contrast(variableColors('fitness')[index], variableColors('fitness-soft')[index])).toBeGreaterThanOrEqual(4.5)
  })

  it('defines a soft canvas and a themed, viewport-positioned task picker', () => {
    expect(css).toContain('--canvas-radius: 26px')
    expect(css).toContain('--radius: 12px')
    expect(ruleFor('.workspace-stage')).toMatch(/border-radius:\s*var\(--canvas-radius\)/)
    expect(ruleFor('.timer-task-menu')).toMatch(/position:\s*fixed/)
    expect(ruleFor('.timer-task-menu')).toMatch(/border-radius:\s*18px/)
    expect(ruleFor('.timer-task-menu')).toMatch(/transform-origin:/)
    expect(ruleFor('.task-picker-check')).toMatch(/aspect-ratio:\s*1\s*\/\s*1/)
    expect(ruleFor('.task-picker-check')).toMatch(/border-radius:\s*50%/)
    expect(ruleFor('[hidden]')).toMatch(/display:\s*none\s*!important/)
  })
})

describe('restrained motion contract', () => {
  it('retains reversible exits and a transform-only selection indicator', () => {
    expect(ruleFor('.motion-presence')).toMatch(/display:\s*contents/)
    expect(ruleFor('.motion-presence[data-state="exiting"] .modal-backdrop')).toMatch(/opacity:\s*0/)
    expect(ruleFor('.selection-indicator')).toMatch(/transition:\s*transform 180ms var\(--ease-out\)/)
    expect(css).toContain(':root[data-motion="instant"] *')
    expect(ruleFor('.status-content')).toMatch(/align-items:\s*center/)
  })
  it('uses one shared motion vocabulary and never animates an unbounded property', () => {
    expect(css).toContain('--ease-out: cubic-bezier(0.23, 1, 0.32, 1)')
    expect(css).toContain('--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1)')
    expect(css).not.toMatch(/transition:\s*all\b/)
    expect(css).not.toContain('@keyframes grow')
    expect(css).not.toContain('animation: reveal')
  })

  it('bridges occasional dialogs and weekly state changes with GPU-only motion', () => {
    expect(ruleFor('.modal-backdrop')).toMatch(/transition:\s*opacity 200ms var\(--ease-out\)/)
    expect(ruleFor('.week-mode-content')).toMatch(/opacity 180ms var\(--ease-out\)/)
    expect(ruleFor('.week-mode-content')).toMatch(/transform 180ms var\(--ease-out\)/)
    expect(ruleFor('.state-content')).toMatch(/opacity 140ms var\(--ease-out\)/)
    expect(css).toMatch(/@starting-style\s*\{[\s\S]*?\.modal-backdrop[\s\S]*?scale\(0\.96\)/)
  })

  it('gates pointer press feedback and removes movement for reduced-motion users', () => {
    expect(css).toMatch(/@media\s*\(hover:\s*hover\)\s*and\s*\(pointer:\s*fine\)[\s\S]*?button:not\(:disabled\)[\s\S]*?scale\(0\.98\)/)
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.week-mode-content[\s\S]*?transform:\s*none/)
  })

  it('introduces the occasional sidebar timer state with restrained GPU-only motion', () => {
    const rule = ruleFor('.timer-sidebar-entry')
    expect(rule).toMatch(/opacity:\s*1/)
    expect(rule).toMatch(/transform:\s*translateY\(0\)/)
    expect(rule).toMatch(/opacity 180ms var\(--ease-out\)/)
    expect(rule).toMatch(/transform 180ms var\(--ease-out\)/)
    expect(css).toMatch(/@starting-style\s*\{[\s\S]*?\.timer-sidebar-entry\s*\{[\s\S]*?translateY\(-4px\)/)
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.timer-sidebar-entry[\s\S]*?transform:\s*none/)
  })

  it('gives newly mounted workspaces a short continuity transition without moving reduced-motion layouts', () => {
    const rule = ruleFor('.workspace')
    expect(rule).toMatch(/opacity:\s*1/)
    expect(rule).toMatch(/transform:\s*none/)
    expect(rule).toMatch(/opacity 160ms var\(--ease-out\)/)
    expect(rule).toMatch(/transform 160ms var\(--ease-out\)/)
    expect(css).toMatch(/@starting-style\s*\{[\s\S]*?\.workspace\s*\{[\s\S]*?translateY\(4px\)/)
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.workspace[\s\S]*?transform:\s*none/)
  })

  it('animates derived progress with one interruptible transform and disables it for reduced motion', () => {
    const fill = ruleFor('.quota-track i')
    expect(fill).toMatch(/transform-origin:\s*left center/)
    expect(fill).toMatch(/transition:\s*transform 180ms var\(--ease-out\)/)
    expect(ruleFor('.quota-fitness .quota-track i')).toMatch(/background:\s*var\(--fitness\)/)
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.quota-track i\s*\{[\s\S]*?transition:\s*none/)
  })
})
