import { z } from 'zod'

/**
 * Zod schema for validating the DataJud API response payload.
 *
 * The DataJud public API returns an Elasticsearch-style response with
 * `hits.hits` containing the matching process documents.
 *
 * Requirements: 7.9 — validate and sanitize the payload returned before
 * persisting any data, refusing malformed payloads.
 */
export const DataJudProcessSchema = z.object({
  hits: z.object({
    hits: z.array(
      z.object({
        _id: z.string(),
        _source: z.object({
          tribunal: z.string().optional(),
          classe: z
            .object({
              nome: z.string(),
            })
            .optional(),
          assuntos: z
            .array(
              z.object({
                nome: z.string(),
              }),
            )
            .optional(),
          movimentos: z
            .array(
              z.object({
                nome: z.string(),
                dataHora: z.string(),
              }),
            )
            .optional(),
          dataAjuizamento: z.string().optional(),
          grau: z.string().optional(),
          numeroProcesso: z.string().optional(),
        }),
      }),
    ),
  }),
})

export type DataJudProcessResponse = z.infer<typeof DataJudProcessSchema>
