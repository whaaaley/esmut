import type { TSESTree } from '@typescript-eslint/typescript-estree'
import esquery from 'esquery'
import type { Selector } from 'esquery'
import type { Node as EstreeNode } from 'estree'
import { known } from './keys.ts'

// typescript-estree and estree describe the same runtime shape but name different node kinds.
// Neither type is assignable to the other, so the two are equated here and nowhere else.
// esquery reads only type and the visitor keys, both of which typescript-estree provides.
export const matchAll = (ast: TSESTree.Node, selector: Selector): TSESTree.Node[] => (
  esquery.match(ast as EstreeNode, selector, { visitorKeys: known }) as TSESTree.Node[]
)

// esquery cannot rebuild ancestry from a bare node, so the parents are passed in.
export const matchesNode = (node: TSESTree.Node, selector: Selector, ancestry: TSESTree.Node[]): boolean => (
  esquery.matches(node as EstreeNode, selector, ancestry as EstreeNode[], { visitorKeys: known })
)
