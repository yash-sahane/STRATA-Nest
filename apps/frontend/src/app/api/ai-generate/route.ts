import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { hasApiSession } from '@/lib/api/server-proxy';
import { logger } from '@/lib/logger';

/**
 * Default generation model.
 *
 * Was `gemini-2.5-flash`, which Google now refuses for keys created after its
 * deprecation: the call comes back 404 with "no longer available to new users",
 * so generation failed for anyone setting up fresh — while continuing to work
 * for older keys. `gemini-3.6-flash` is the replacement Google names in that
 * error. Override with GEMINI_MODEL when a different one is wanted.
 */
const GEMINI_MODEL =
  process.env.GEMINI_MODEL || process.env.NEXT_PUBLIC_GEMINI_MODEL || 'gemini-3.6-flash';
// Operator secrets, read only on the server. The unprefixed names are the ones
// to set: Next.js inlines any NEXT_PUBLIC_* value into the client bundle at each
// client-side reference, so naming a provider key that way is one stray import
// away from shipping it to browsers. The NEXT_PUBLIC_ reads are kept as a
// fallback so existing deployments keep working.
const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? process.env.NEXT_PUBLIC_GEMINI_API_KEY ?? '';
const HF_API_KEY = process.env.HF_API_KEY ?? process.env.NEXT_PUBLIC_HF_API_KEY ?? '';
const HF_MODEL =
  process.env.HF_MODEL || process.env.NEXT_PUBLIC_HF_MODEL || 'meta-llama/Llama-3.1-8B-Instruct';
const HF_ENDPOINT =
  process.env.HF_ENDPOINT ||
  process.env.NEXT_PUBLIC_HF_ENDPOINT ||
  'https://router.huggingface.co/v1/chat/completions';

// Initialize Gemini client
const genAI = GEMINI_API_KEY ? new GoogleGenerativeAI(GEMINI_API_KEY) : null;

/**
 * Call HuggingFace API directly via REST
 * Supports both the chat completions router and the inference API
 */
async function callHuggingFace(prompt: string): Promise<string> {
  try {
    if (!HF_API_KEY) {
      throw new Error('HuggingFace API key is not configured');
    }

    logger.debug('[HF] Using model', { model: HF_MODEL, endpoint: HF_ENDPOINT, keyConfigured: !!HF_API_KEY });

    // Check if using the chat completions router (OpenAI-compatible)
    const isRouterEndpoint =
      HF_ENDPOINT.includes('router.huggingface.co') || HF_ENDPOINT.includes('/chat/completions');

    let requestBody: object;
    let url: string;

    if (isRouterEndpoint) {
      // OpenAI-compatible chat completions format
      url = HF_ENDPOINT;
      requestBody = {
        model: HF_MODEL,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
        max_tokens: 4096,
        temperature: 0.7,
      };
    } else {
      // Text generation inference format
      url = `${HF_ENDPOINT}/${HF_MODEL}`;
      requestBody = {
        inputs: prompt,
        parameters: {
          max_new_tokens: 4096,
          temperature: 0.7,
          return_full_text: false,
        },
      };
    }

    logger.debug('[HF] Request URL', { url });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${HF_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('[HF] HTTP Error', { status: response.status, body: errorText });
      throw new Error(`HuggingFace API Error ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    logger.debug('[HF] Response received', { preview: JSON.stringify(data).slice(0, 200) });

    // Parse response based on format
    let text = '';

    if (isRouterEndpoint) {
      // OpenAI-compatible response format
      if (data.choices && data.choices[0]) {
        text = data.choices[0].message?.content?.trim() || '';
      }
    } else {
      // HuggingFace inference response format
      if (Array.isArray(data) && data[0]) {
        text = data[0].generated_text?.trim() || '';
      } else if (data.generated_text) {
        text = data.generated_text.trim();
      } else if (typeof data === 'string') {
        text = data.trim();
      }
    }

    if (!text) {
      logger.error('[HF] Empty response', { data });
      throw new Error('No output from HuggingFace');
    }

    logger.debug('[HF] Successfully generated response');
    return text;
  } catch (error: any) {
    const errorMsg = error?.message || String(error);
    logger.error('[HF] Error', { message: errorMsg, status: error?.status });
    throw error;
  }
}

/**
 * Call Gemini API using Google GenAI SDK
 */
async function callGemini(prompt: string): Promise<string> {
  try {
    if (!GEMINI_API_KEY || !genAI) {
      throw new Error('Gemini API key is not configured');
    }

    logger.debug('[Gemini] Using model', { model: GEMINI_MODEL });

    const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });

    const result = await model.generateContent(prompt);
    const text = result.response.text();

    if (!text) {
      throw new Error('No output from Gemini');
    }

    logger.debug('[Gemini] Successfully generated response');
    return text.trim();
  } catch (error: any) {
    const errorMsg = error?.message || String(error);
    logger.error('[Gemini] Error', { message: errorMsg, status: error?.status });
    throw error;
  }
}

export async function POST(request: NextRequest) {
  try {
    // This route calls the model with the OPERATOR's key and never reaches the
    // backend, so without this check any anonymous POST spends their quota.
    if (!(await hasApiSession(request))) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const { prompt, maxRetries = 2 } = await request.json();

    if (typeof prompt !== 'string' || !prompt.trim()) {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
    }
    // maxRetries is caller-supplied: a huge value would be a free way to make
    // the server sit in a retry loop against the model provider.
    const retries = Math.min(Math.max(Number(maxRetries) || 1, 1), 3);

    let lastError: Error | null = null;

    // Try Gemini FIRST (more reliable, faster)
    if (GEMINI_API_KEY) {
      for (let attempt = 0; attempt < retries; attempt++) {
        try {
          logger.debug(`Attempting Gemini (attempt ${attempt + 1}/${retries})`);
          const text = await callGemini(prompt);
          return NextResponse.json({ text, provider: 'gemini' });
        } catch (error: unknown) {
          lastError = error instanceof Error ? error : new Error(String(error));
          logger.warn(`Gemini attempt ${attempt + 1} failed`, { error: lastError.message });
          if (attempt < retries - 1) {
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        }
      }
      logger.warn('Gemini failed all attempts, falling back to HuggingFace');
    } else {
      logger.debug('Gemini API key not configured, trying HuggingFace');
    }

    // Fallback to HuggingFace (can be slow/unreliable)
    if (HF_API_KEY) {
      // Only 1 retry for HuggingFace since it's slow
      try {
        logger.debug('Attempting HuggingFace (fallback)');
        const text = await callHuggingFace(prompt);
        return NextResponse.json({ text, provider: 'huggingface' });
      } catch (error: unknown) {
        lastError = error instanceof Error ? error : new Error(String(error));
        logger.warn('HuggingFace fallback failed', { error: lastError.message });
      }
    } else {
      if (!GEMINI_API_KEY) {
        // Unconfigured is not a server fault — it is a deployment that never
        // enabled the feature, so say which knob turns it on rather than
        // handing the user a bare 500.
        return NextResponse.json(
          {
            error:
              'AI generation is not configured on this deployment. Set GEMINI_API_KEY (or HF_API_KEY) in the frontend environment to enable it.',
          },
          { status: 503 }
        );
      }
    }

    // All attempts failed
    return NextResponse.json(
      {
        error: `AI generation failed: ${lastError?.message || 'Unknown error'}`,
      },
      { status: 500 }
    );
  } catch (error: unknown) {
    logger.error('AI Generation API Error', { error });
    return NextResponse.json(
      {
        error:
          (error instanceof Error ? error.message : String(error)) ||
          'Failed to generate AI response',
      },
      { status: 500 }
    );
  }
}
