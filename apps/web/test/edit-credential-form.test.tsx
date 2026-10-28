import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EditCredentialForm } from '../app/(office)/workers/[id]/edit-credential-form';

const noop = () => {};

describe('credential edit form', () => {
  it('fills in what is recorded and keeps the type’s required fields required', () => {
    const html = renderToStaticMarkup(
      <EditCredentialForm
        c={{ number: 'NPC-7', issuedBy: 'Example Checks', issueDate: '2026-01-02', expiryDate: '2027-01-02', notes: 'Seen', verification: 'verified' }}
        hasNumber hasExpiry action={noop}
      />,
    );
    const number = html.match(/<input[^>]*name="number"[^>]*>/)?.[0] ?? '';
    expect(number).toContain('required=""');
    expect(number).toContain('value="NPC-7"');
    expect(html).toContain('value="Example Checks"');
    expect(html).toContain('value="2027-01-02"');
    expect(html).toContain('>Seen</textarea>');
    expect(html).toContain('needs checking again');
  });

  it('leaves out a number or expiry the type doesn’t use, unless one was recorded', () => {
    const html = renderToStaticMarkup(
      <EditCredentialForm c={{ number: null, issueDate: null, expiryDate: '2027-01-02', verification: 'unverified' }} hasNumber={false} hasExpiry={false} action={noop} />,
    );
    expect(html).not.toContain('name="number"');
    expect(html).toContain('name="expiryDate"');
    expect(html).not.toContain('required=""');
    expect(html).not.toContain('needs checking again');
  });
});
