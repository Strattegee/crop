import { NextResponse } from 'next/server';
import { api, ApiError } from '../../../../../../../lib/api';

export const dynamic = 'force-dynamic';

/** Opens a credential document: gets a 5-minute link from the API (which checks access) and redirects to it. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; credentialId: string; documentId: string }> }) {
  const { id, credentialId, documentId } = await params;
  try {
    const { url } = await api<{ url: string }>(`/workers/${id}/credentials/${credentialId}/documents/${documentId}/link`);
    return NextResponse.redirect(url, { headers: { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
  } catch (err) {
    if (err && typeof err === 'object' && 'digest' in err) throw err;
    const message = err instanceof ApiError ? err.message : 'Could not open the document';
    return new NextResponse(message, { status: err instanceof ApiError ? err.status : 500 });
  }
}
