// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TimerSidebarStatus } from './TimerSidebarStatus'

afterEach(cleanup)

describe('TimerSidebarStatus', () => {
  it('shows task context while keeping the compact timer action', async () => {
    const onOpen = vi.fn()
    render(<TimerSidebarStatus active={{
      id: 'focused',
      mode: 'elapsed',
      status: 'running',
      createdAt: '2026-08-20T08:00:00.000Z',
      segmentStartedAt: '2026-08-20T08:00:00.000Z',
      accumulatedSeconds: 0,
      updatedAt: '2026-08-20T08:00:00.000Z',
      taskIntent: { date: '2026-08-20', taskId: 'nlp-1', taskTitle: 'NLP 论文精读' }
    }} seconds={125} onOpen={onOpen} />)

    expect(screen.getByText('02:05')).toBeTruthy()
    expect(screen.getByText('NLP 论文精读')).toBeTruthy()
    const trigger = screen.getByRole('button', { name: '打开计时器' })
    const descriptionId = trigger.getAttribute('aria-describedby')
    expect(descriptionId).toBeTruthy()
    expect(document.getElementById(descriptionId ?? '')?.textContent).toBe('NLP 论文精读，计时中')
    await userEvent.click(trigger)
    expect(onOpen).toHaveBeenCalledOnce()
  })
})
