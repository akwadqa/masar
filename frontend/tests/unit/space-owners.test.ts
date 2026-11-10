import { describe, expect, it } from 'vitest'
import type { SpaceSummary, UserRef } from '~/types/api'
import { spaceOwners } from '~/utils/spaceOwners'

const user = (name: string, fullName: string): UserRef => ({ name, fullName, image: null })
const space = (owner: UserRef) => ({ owner }) as SpaceSummary

describe('spaceOwners', () => {
  it('lists each owner once, sorted by full name', () => {
    const zaid = user('zaid@example.com', 'Zaid')
    const amal = user('amal@example.com', 'Amal')
    expect(spaceOwners([space(zaid), space(amal), space(zaid)])).toEqual([amal, zaid])
  })

  it('is empty for no Spaces', () => {
    expect(spaceOwners([])).toEqual([])
  })
})
