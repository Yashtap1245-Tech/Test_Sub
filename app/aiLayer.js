// aiLayer.js — Gemini API Intent Extraction & Natural Language Summarization
import { logger } from './logger.js';

export const aiLayer = {
  /**
   * Translates natural language question into queryEngine parameters using Gemini API
   * @param {string} question 
   * @param {Object} metadata (lists of agencies, categories, subcategories)
   * @param {string} apiKey 
   * @returns {Promise<Object>} Structured query JSON
   */
  async extractIntent(question, metadata, apiKey) {
    const startTime = performance.now();
    logger.event('ai_intent_extraction_started', { question });

    const systemInstruction = `
You are the query intent parser for PolicyLens, an app exploring WA State Vendor Payments (FY2022 & FY2023).
Translate the user's natural language question into a structured JSON query object matching the schema below.

Allowed Agencies (only match exact substring or close match from this list):
${JSON.stringify(metadata.agencies)}

Allowed Categories (only match exact or close match from this list):
${JSON.stringify(metadata.categories)}

Available Subcategories (only match if explicitly asked):
${JSON.stringify(metadata.subcategories)}

Output JSON Schema:
{
  "out_of_scope": boolean (Must be set to true if the question refers to years other than 2022 or 2023, states or entities outside Washington State, or general topics/questions unrelated to WA vendor spending records. Otherwise false),
  "agency": string or array of strings or null (Must match one of the Allowed Agencies closely. If they ask for 'DOT' or 'Transportation', map to 'Transportation'. If they ask for 'health' or 'HCA', map to 'Health Care Authority', etc. If they don't specify, set to null),
  "category": string or array of strings or null (Must match one of the Allowed Categories),
  "subcategory": string or null (Must match one of the Available Subcategories),
  "vendor": string or null (Name of specific vendor if mentioned, e.g. "Microsoft" or "Orsini"),
  "fiscal_year": "2022" | "2023" | null (Map 2022 -> "2022", 2023 -> "2023", if not specified or "both" -> null),
  "group_by": "agency" | "category" | "subcategory" | "vendor" | "month" | "year" (Select the dimension to split the chart. E.g. "breakdown by category" -> "category", "how did spend change over time/months" -> "month", "top vendors" -> "vendor", "by agency" -> "agency"),
  "metric": "total_amount" | "tx_count",
  "sort": "desc" | "asc",
  "limit": number (default is 15),
  "intent_label": string (A clean, human-readable title summarizing what this query is filtering, e.g. "Top categories by spend for Department of Transportation, FY2023")
}

Strict Guardrail Guidelines:
- If the question asks about a fiscal year other than 2022 or 2023 (e.g. 2021, 2024, 2025, 2026), set "out_of_scope" to true.
- If the question references location, state, or country other than Washington State (e.g. California, Oregon, Texas, or city/federal level), set "out_of_scope" to true.
- If the question is completely unrelated to WA state vendor contract payments (e.g. general knowledge, writing code, weather, etc.), set "out_of_scope" to true.
- If "out_of_scope" is true, you MUST set all other parameters (agency, category, subcategory, vendor, fiscal_year) to null.
- Default metric is "total_amount". If they ask "how many times", "count", "number of payments", use "tx_count".
- If they ask for a general comparison without specifying a group_by, set group_by to "category" (to see category breakdown) or "agency" (if looking at state-wide spend).
- If they mention a vendor (like "Microsoft"), set "vendor": "Microsoft" (or a clean version of the name) and set "group_by": "vendor" or "agency" depending on query context.
- Return ONLY the raw JSON block. No markdown, no triple backticks, no wrapping. Just valid JSON.
`;

    try {
      if (apiKey === 'mock' || apiKey === 'mock_key' || !apiKey) {
        const qLower = question.toLowerCase();
        let parsedIntent;
        if (qLower.includes('california') || qLower.includes('2021') || qLower.includes('weather') || qLower.includes('code') || qLower.includes('2025')) {
          parsedIntent = {
            out_of_scope: true,
            agency: null,
            category: null,
            subcategory: null,
            vendor: null,
            fiscal_year: null,
            group_by: 'category',
            metric: 'total_amount',
            sort: 'desc',
            limit: 15,
            intent_label: 'Out of Scope Request'
          };
        } else if (qLower.includes('health') || qLower.includes('hca')) {
          parsedIntent = {
            out_of_scope: false,
            agency: 'Health Care Authority',
            category: null,
            subcategory: null,
            vendor: null,
            fiscal_year: null,
            group_by: 'vendor',
            metric: 'total_amount',
            sort: 'desc',
            limit: 10,
            intent_label: 'Top vendors by spend for Health Care Authority'
          };
        } else if (qLower.includes('nonexistent_filter_test')) {
          // A filter that returns no data
          parsedIntent = {
            out_of_scope: false,
            agency: 'Nonexistent Agency',
            category: null,
            subcategory: null,
            vendor: null,
            fiscal_year: null,
            group_by: 'category',
            metric: 'total_amount',
            sort: 'desc',
            limit: 15,
            intent_label: 'Nonexistent Query'
          };
        } else {
          parsedIntent = {
            out_of_scope: false,
            agency: null,
            category: null,
            subcategory: null,
            vendor: null,
            fiscal_year: '2023',
            group_by: 'category',
            metric: 'total_amount',
            sort: 'desc',
            limit: 15,
            intent_label: 'Top categories by spend in FY2023'
          };
        }

        logger.event('ai_intent_extraction_success', {
          question,
          parsedIntent,
          latencyMs: performance.now() - startTime,
          simulated: true
        });
        return parsedIntent;
      }

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: `Question: "${question}"\nParse this into structured JSON query parameters.` }] }],
            systemInstruction: { parts: [{ text: systemInstruction }] },
            generationConfig: {
              responseMimeType: "application/json",
              temperature: 0.1
            }
          })
        }
      );

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`API error (${response.status}): ${errText}`);
      }

      const resJson = await response.json();
      const textResponse = resJson.candidates[0].content.parts[0].text;
      const parsedIntent = JSON.parse(textResponse.trim());

      logger.event('ai_intent_extraction_success', {
        question,
        parsedIntent,
        latencyMs: performance.now() - startTime
      });

      return parsedIntent;
    } catch (error) {
      logger.event('ai_intent_extraction_failed', {
        question,
        error: error.message,
        latencyMs: performance.now() - startTime
      });
      throw error;
    }
  },

  /**
   * Generates a plain-English description of the query results
   * @param {string} question 
   * @param {Object} queryObj 
   * @param {Object} queryResults 
   * @param {string} apiKey 
   * @returns {Promise<string>} Plain-English summary
   */
  async generateSummary(question, queryObj, queryResults, apiKey) {
    const startTime = performance.now();
    logger.event('ai_summary_generation_started', { question });

    const totalSpendFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(queryResults.meta.totalSpend);
    const resultRowsSnippet = queryResults.results.slice(0, 5).map(r => {
      const amt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(r.value);
      return `- ${r.label}: ${amt} (${r.count} payments)`;
    }).join('\n');

    const systemInstruction = `
You are the insights generator for PolicyLens, an app exploring WA State Vendor Payments (FY2022 & FY2023).
Your job is to read a user's question, the structured query executed, and the top results, and write a concise, professional 2-sentence summary answering the question.

Strict Guardrail Guidelines:
1. Base your answers ONLY on the raw data provided in the prompt. Do NOT make up, assume, or hallucinate any numbers, names, or metrics.
2. If the total spend matching the scope is 0, or if the top results list is empty, state clearly that there is no recorded spending matching this request in the database. Do not invent any vendors or categories.
3. Do not use markdown lists. Do not mention coding, JSON, tables, or database fields.
4. Keep it under 60 words. Make it sound like a top-tier policy analyst writing a bullet memo summary.
`;

    const userPrompt = `
User Question: "${question}"
Executed Intent: ${JSON.stringify(queryObj)}
Total Spend matching this scope: ${totalSpendFmt}
Total transactions/payments: ${queryResults.meta.totalTransactions}
Top Results returned:
${resultRowsSnippet}

Write the 2-sentence insights summary.
`;

    try {
      if (apiKey === 'mock' || apiKey === 'mock_key' || !apiKey) {
        let summaryText;
        if (queryObj.out_of_scope) {
          summaryText = 'No data is generated since the request is out of scope.';
        } else {
          summaryText = `Mocked AI Insight: In FY2023, Washington State spent a total of ${totalSpendFmt} on various state vendor contracts. The top category represented the majority of this expenditure.`;
        }

        logger.event('ai_summary_generation_success', {
          summaryLength: summaryText.length,
          latencyMs: performance.now() - startTime,
          simulated: true
        });
        return summaryText;
      }

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: userPrompt }] }],
            systemInstruction: { parts: [{ text: systemInstruction }] },
            generationConfig: {
              temperature: 0.3
            }
          })
        }
      );

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const resJson = await response.json();
      const summary = resJson.candidates[0].content.parts[0].text.trim();

      logger.event('ai_summary_generation_success', {
        summaryLength: summary.length,
        latencyMs: performance.now() - startTime
      });

      return summary;
    } catch (error) {
      logger.event('ai_summary_generation_failed', {
        error: error.message,
        latencyMs: performance.now() - startTime
      });
      // Return a basic fallback summary constructed client-side
      return `Total spending found for this search is ${totalSpendFmt} across ${queryResults.meta.totalTransactions} records. The top item is ${queryResults.results[0]?.label || 'none'} with ${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(queryResults.results[0]?.value || 0)}.`;
    }
  },

  /**
   * Generates alternative suggestions for ambiguous queries
   * @param {string} question 
   * @param {string} apiKey 
   * @returns {Promise<Array<string>>} List of 3 suggested questions
   */
  async suggestAlternatives(question, apiKey) {
    const prompt = `
The user asked a query that couldn't be parsed: "${question}".
Suggest 3 clean, simple, alternative questions they could ask to explore the WA state vendor payments data (FY 2022 and FY 2023).
Examples of good questions:
- "What were the top 10 categories of spend in 2023?"
- "Which vendors got the most money from the Health Care Authority?"
- "How did Department of Transportation spending change month over month?"
- "Show me the top vendors for personal service contracts."

Return a JSON array of strings containing exactly 3 items. E.g. ["question 1", "question 2", "question 3"].
Return ONLY the JSON array. Do not include markdown codeblocks or notes.
`;

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              responseMimeType: "application/json",
              temperature: 0.7
            }
          })
        }
      );

      if (!response.ok) throw new Error("API error");
      const resJson = await response.json();
      const text = resJson.candidates[0].content.parts[0].text;
      return JSON.parse(text.trim());
    } catch (error) {
      return [
        "What were the top 10 categories of spend in 2023?",
        "Which vendors got the most money from the Health Care Authority?",
        "How did Department of Transportation spending change month over month?"
      ];
    }
  }
};
