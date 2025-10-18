import { createClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
export const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_KEY!);
