import { Fragment } from 'react';
import { parseMarkdown, type Inline } from '../../lib/legal/markdown';

function Text({ parts }: { parts: Inline[] }) {
  return <>{parts.map((p, i) => p.placeholder ? <mark key={i} title="Still to be filled in">{p.text}</mark> : <Fragment key={i}>{p.text}</Fragment>)}</>;
}

export function LegalBody({ markdown }: { markdown: string }) {
  return (
    <>
      {parseMarkdown(markdown).map((b, i) => {
        switch (b.kind) {
          case 'h2': return <h2 key={i} id={b.id}>{b.text}</h2>;
          case 'h3': return <h3 key={i} id={b.id}>{b.text}</h3>;
          case 'p': return <p key={i}><Text parts={b.parts} /></p>;
          case 'ul': return <ul key={i}>{b.items.map((it, j) => <li key={j}><Text parts={it} /></li>)}</ul>;
          case 'table': return (
            <table key={i}>
              <thead><tr>{b.head.map((c, j) => <th key={j}><Text parts={c} /></th>)}</tr></thead>
              <tbody>{b.rows.map((r, j) => <tr key={j}>{r.map((c, k) => <td key={k}><Text parts={c} /></td>)}</tr>)}</tbody>
            </table>
          );
        }
      })}
    </>
  );
}
