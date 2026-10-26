import { describe, expect, it } from 'vitest'
import { PetThemePreview } from './PetThemePicker'

describe('legacy theme preview inside a designed active app', () => {
  it('overrides inherited material and control styling without changing its saved colors', () => {
    const preview = PetThemePreview({ accent: '#b3a469', saved: true })
    const style = preview.props.style
    expect(style['--companion-material']).toBe('var(--companion-surface)')
    expect(style['--companion-material-inset']).toBe('none')
    expect(style['--companion-action-border']).toBe('transparent')
    expect(style['--companion-control-radius']).toBe('99px')
    expect(style['--companion-border-width']).toBe('1px')
    expect(style['--companion-radius']).toBe('14px')
    expect(style['--companion-surface']).toBe('#fcfbf7')
  })
})
