import { NextResponse } from 'next/server';
import { api, ApiError } from '../../../../../../lib/api';

export const dynamic = 'force-dynamic';

/** Opens a file sent with an online application via a 5-minute link from the API. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; fileId: string }> }) {
  const { fileId } = await params;
  try {
    const { url } = await api<{ url: string }>(`/job-application-files/${fileId}/link`);
    return NextResponse.redirect(url, { headers: { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
  } catch (err) {
    if (err && typeof err === 'object' && 'digest' in err) throw err;
    return new NextResponse(err instanceof ApiError ? err.message : 'Could not open the file', { status: err instanceof ApiError ? err.status : 500 });
  }
}
