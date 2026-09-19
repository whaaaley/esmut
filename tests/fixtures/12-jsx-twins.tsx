// JSX elements identical but for an attribute, reached only when parseSource turns the jsx flag on for a .tsx path.
// The sites sit in attribute values and in the guard above them, so a JSX kind the walk cannot enter reads as stale.

type Props = { label: string; active: boolean }

export const Badge = (props: Props): JSX.Element => {
  if (props.active) {
    return <span className='badge' title='active'>{props.label}</span>
  }

  return <span className='badge' title='idle'>{props.label}</span>
}
