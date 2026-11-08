import { Router, Request, Response } from 'express';
import { pool } from './db.js';
import { FieldDef, ResourceDef, RESOURCES, getResource, writableFields, columnNames, colunaSql } from './schema.js';
import { antesDeExcluir, antesDeGravar } from './romaneio.js';

// O SQL próprio (combos, colunas calculadas) não sai do servidor
const RESOURCES_PUBLICOS = RESOURCES.map(({ optionsSql, ...r }) => ({ ...r, fields: r.fields.map(({ sql, ...f }) => f) }));

/** Converte o valor recebido do formulário para o tipo esperado pela coluna do MySQL */
function coerceValue(field: FieldDef, raw: any): any {
  if (raw === undefined) return undefined;
  if (raw === null || raw === '') {
    // Campos obrigatórios em branco viram string vazia; opcionais viram NULL
    return field.required && (field.type === 'text' || field.type === 'cnpj') ? '' : null;
  }

  switch (field.type) {
    case 'number': {
      const n = Number(raw);
      return Number.isFinite(n) ? Math.trunc(n) : null;
    }
    case 'decimal': {
      const n = typeof raw === 'string' ? Number(raw.replace(',', '.')) : Number(raw);
      return Number.isFinite(n) ? n : null;
    }
    case 'boolean': {
      const sim = raw === true || raw === 1 || raw === '1' || raw === 'true';
      if (field.simNao) return sim ? 'S' : 'N';
      return sim ? 1 : 0;
    }
    case 'cnpj':
      // Dígitos e, no CNPJ alfanumérico, letras maiúsculas
      return String(raw).toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 14);
    case 'date':
      return String(raw).slice(0, 10);
    case 'datetime':
      return String(raw).replace('T', ' ').slice(0, 19);
    case 'time': {
      const t = String(raw).slice(0, 8);
      return /^\d{2}:\d{2}$/.test(t) ? `${t}:00` : t;
    }
    default:
      return String(raw);
  }
}

/** Monta o payload de gravação a partir do corpo da requisição, aplicando a whitelist de colunas */
function buildWritePayload(resource: ResourceDef, body: Record<string, any>, isUpdate: boolean): Record<string, any> {
  const payload: Record<string, any> = {};

  for (const field of writableFields(resource)) {
    if (!(field.name in body)) continue;

    payload[field.name] = coerceValue(field, body[field.name]);
  }

  return payload;
}

/** Valida os campos obrigatórios antes de tocar no banco, para devolver mensagem amigável */
function validateRequired(resource: ResourceDef, payload: Record<string, any>, isUpdate: boolean) {
  const faltando: string[] = [];

  for (const field of writableFields(resource)) {
    if (!field.required) continue;
    if (field.type === 'password') continue;
    if (isUpdate && !(field.name in payload)) continue;

    const value = payload[field.name];
    if (value === null || value === undefined || value === '') {
      faltando.push(field.label);
    }
  }

  if (faltando.length) {
    throw new Error(`Preencha os campos obrigatórios: ${faltando.join(', ')}.`);
  }
}

/** Traduz erros do MySQL para mensagens legíveis ao operador */
export function friendlyDbError(err: any, labelSingular = 'registro'): string {
  switch (err?.code) {
    case 'ER_DUP_ENTRY':
      return `Já existe um registro de ${labelSingular} com esse valor único (${err.sqlMessage?.match(/for key '(.+?)'/)?.[1] || 'chave duplicada'}).`;
    case 'ER_ROW_IS_REFERENCED_2':
    case 'ER_ROW_IS_REFERENCED':
      return `Este ${labelSingular} não pode ser excluído porque existem registros vinculados a ele.`;
    case 'ER_NO_REFERENCED_ROW_2':
    case 'ER_NO_REFERENCED_ROW':
      return 'Um dos vínculos informados (chave estrangeira) não existe. Verifique os campos de seleção.';
    case 'ER_DATA_TOO_LONG':
      return `Um dos campos excedeu o tamanho permitido: ${err.sqlMessage || ''}`;
    case 'ER_BAD_NULL_ERROR':
      return `Um campo obrigatório ficou em branco: ${err.sqlMessage || ''}`;
    case 'WARN_DATA_TRUNCATED':
      return 'Um dos valores selecionados não é aceito por esta coluna. Verifique os campos de seleção.';
    default:
      return err?.sqlMessage || err?.message || 'Erro inesperado ao acessar o banco de dados.';
  }
}

export function createCrudRouter() {
  const router = Router();

  function resolveResource(req: Request): ResourceDef {
    const resource = getResource(req.params.resource);
    if (!resource) {
      throw new Error(`Recurso "${req.params.resource}" não existe.`);
    }
    return resource;
  }

  const pkCol = (resource: ResourceDef) => resource.pk[0];

  // --------------------------------------------------------
  // Metadados: alimenta as telas genéricas de CRUD
  // --------------------------------------------------------
  router.get('/meta/resources', (_req: Request, res: Response) => {
    res.json(RESOURCES_PUBLICOS);
  });

  // --------------------------------------------------------
  // Opções de chave estrangeira (combos dos formulários)
  // --------------------------------------------------------
  router.get('/options/:resource', async (req: Request, res: Response) => {
    try {
      const resource = resolveResource(req);
      const labelField = String(req.query.label_field || resource.labelField);

      if (!columnNames(resource).includes(labelField) || resource.fields.find((f) => f.name === labelField)?.sql) {
        throw new Error(`Campo de rótulo "${labelField}" inválido.`);
      }

      const sql =
        (labelField === resource.labelField && resource.optionsSql) ||
        `SELECT t.${pkCol(resource)} AS value, t.${labelField} AS label
           FROM ${resource.table} t
          ORDER BY t.${labelField} ASC`;
      // ponytail: o combo filtra no navegador; com mais de 20 mil registros, buscar no servidor
      const [rows] = await pool.query<any[]>(`${sql} LIMIT 20000`);

      res.json(rows.map((r) => ({ value: String(r.value), label: String(r.label ?? r.value) })));
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // --------------------------------------------------------
  // Listagem paginada com busca e ordenação
  // --------------------------------------------------------
  router.get('/crud/:resource', async (req: Request, res: Response) => {
    try {
      const resource = resolveResource(req);
      const page = Math.max(1, Number(req.query.page) || 1);
      const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 25));
      const offset = (page - 1) * limit;

      const sortField = columnNames(resource).includes(String(req.query.sort))
        ? String(req.query.sort)
        : resource.defaultSort.field;
      const dirQ = String(req.query.dir).toLowerCase();
      const sortDir = dirQ === 'asc' ? 'ASC' : dirQ === 'desc' ? 'DESC' : resource.defaultSort.dir.toUpperCase();

      const where: string[] = ['1 = 1'];
      const params: any[] = [];

      // Busca textual nos campos marcados como searchable
      const search = String(req.query.search || '').trim();
      if (search) {
        const searchable = resource.fields.filter((f) => f.searchable);
        if (searchable.length) {
          where.push(`(${searchable.map((f) => `${colunaSql(resource, f.name)} LIKE ?`).join(' OR ')})`);
          searchable.forEach(() => params.push(`%${search}%`));
        }
      }

      // Filtro exato por coluna (painel mestre-detalhe): ?filter_field=negocio_id&filter_value=...
      const filterField = String(req.query.filter_field || '');
      const filterValue = req.query.filter_value;
      if (filterField && filterValue !== undefined && filterValue !== '' && columnNames(resource).includes(filterField)) {
        where.push(`${colunaSql(resource, filterField)} = ?`);
        params.push(filterValue);
      }

      // Busca avançada: ?filters=[{"field":"status","op":"eq","value":"aberto"}]
      // Coluna e operador passam por whitelist; o valor vai sempre como parâmetro.
      const filtersRaw = String(req.query.filters || '').trim();
      if (filtersRaw) {
        let parsed: any[];
        try {
          parsed = JSON.parse(filtersRaw);
        } catch {
          throw new Error('Parâmetro "filters" não contém um JSON válido.');
        }
        if (!Array.isArray(parsed)) throw new Error('Parâmetro "filters" deve ser uma lista.');
        if (parsed.length > 20) throw new Error('São aceitos no máximo 20 filtros por consulta.');

        const colunas = columnNames(resource);
        for (const f of parsed) {
          const campo = String(f?.field || '');
          const op = String(f?.op || '');
          const valor = f?.value;

          if (!colunas.includes(campo)) {
            throw new Error(`Filtro inválido: a coluna "${campo}" não existe em ${resource.label}.`);
          }
          // Filtrar por hash de senha (LIKE '%a%', '%ab%'...) permitiria reconstruí-lo aos poucos
          if (resource.fields.find((d) => d.name === campo)?.type === 'password') {
            throw new Error(`Filtro inválido: a coluna "${campo}" não pode ser pesquisada.`);
          }
          if (valor === undefined || valor === null || valor === '') continue;

          const ops: Record<string, string> = { eq: '=', ne: '<>', gte: '>=', lte: '<=' };
          if (op === 'contains') {
            where.push(`${colunaSql(resource, campo)} LIKE ?`);
            params.push(`%${valor}%`);
          } else if (ops[op]) {
            where.push(`${colunaSql(resource, campo)} ${ops[op]} ?`);
            params.push(valor);
          } else {
            throw new Error(`Filtro inválido: operador "${op}" não é suportado.`);
          }
        }
      }

      const whereSql = where.join(' AND ');

      const [countRows] = await pool.query<any[]>(`SELECT COUNT(*) AS total FROM ${resource.table} t WHERE ${whereSql}`, params);
      const total = Number(countRows[0]?.total || 0);

      const calculadas = resource.fields.filter((f) => f.sql);
      // Nome do registro ligado (<campo>__rotulo): a lista mostra mesmo quando ele passa do limite dos combos
      const rotulos = resource.fields.flatMap((f) => {
        const ref = f.ref && !f.sql ? getResource(f.ref.resource) : null;
        const campo = ref?.fields.find((x) => x.name === f.ref!.labelField);
        if (!ref || !campo || campo.sql) return [];
        return [`, (SELECT r.${campo.name} FROM ${ref.table} r WHERE r.${pkCol(ref)} = t.${f.name} LIMIT 1) AS ${f.name}__rotulo`];
      });
      // A senha nunca sai do servidor, nem em hash
      const senhas = resource.fields.filter((f) => f.type === 'password').map((f) => f.name);
      // Campo ligado (ex.: Grupo do produto): ordena pelo nome do registro ligado, os vazios no fim e, no empate,
      // pelo nome do próprio registro
      const ordenaRotulo = rotulos.some((r) => r.endsWith(` AS ${sortField}__rotulo`));
      const ordem = ordenaRotulo
        ? `(t.${sortField} IS NULL), ${sortField}__rotulo ${sortDir}, t.${resource.labelField} ASC`
        : `${calculadas.some((f) => f.name === sortField) ? sortField : `t.${sortField}`} ${sortDir}`;
      const [rows] = await pool.query<any[]>(
        `SELECT t.*${calculadas.map((f) => `, ${f.sql} AS ${f.name}`).join('')}${rotulos.join('')} FROM ${resource.table} t
          WHERE ${whereSql}
          ORDER BY ${ordem}, t.${pkCol(resource)} ${sortDir}
          LIMIT ? OFFSET ?`,
        [...params, limit, offset],
      );
      for (const r of rows) for (const s of senhas) r[s] = r[s] ? '********' : '';

      res.json({ data: rows, total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) });
    } catch (err: any) {
      res.status(err.status || 400).json({ error: err.message });
    }
  });

  // --------------------------------------------------------
  // Leitura de um registro
  // --------------------------------------------------------
  router.get('/crud/:resource/:id', async (req: Request, res: Response) => {
    try {
      const resource = resolveResource(req);
      // Com as calculadas: o Sim/Não 'S'/'N' chega como 1/0, como na lista
      const calculadas = resource.fields.filter((f) => f.sql);
      const [rows] = await pool.query<any[]>(
        `SELECT t.*${calculadas.map((f) => `, ${f.sql} AS ${f.name}`).join('')} FROM ${resource.table} t WHERE t.${pkCol(resource)} = ? LIMIT 1`,
        [req.params.id],
      );
      if (!rows.length) return res.status(404).json({ error: `${resource.labelSingular} não encontrado.` });
      for (const f of resource.fields) if (f.type === 'password') rows[0][f.name] = '';
      res.json(rows[0]);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // --------------------------------------------------------
  // Criação
  // --------------------------------------------------------
  router.post('/crud/:resource', async (req: Request, res: Response) => {
    let resource: ResourceDef | null = null;
    try {
      resource = resolveResource(req);
      if (!resource.canCreate) {
        return res.status(403).json({ error: `Não é permitido incluir registros em ${resource.label}.` });
      }

      const payload = buildWritePayload(resource, req.body || {}, false);
      validateRequired(resource, payload, false);
      await antesDeGravar(resource.name, payload, null);

      const cols = Object.keys(payload);
      const [result] = await pool.query<any>(
        `INSERT INTO ${resource.table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
        cols.map((c) => payload[c]),
      );

      const newId = String(result.insertId);
      res.json({ success: true, id: newId });
    } catch (err: any) {
      res.status(err.status || 400).json({ error: friendlyDbError(err, resource?.labelSingular) });
    }
  });

  // --------------------------------------------------------
  // Alteração
  // --------------------------------------------------------
  router.put('/crud/:resource/:id', async (req: Request, res: Response) => {
    let resource: ResourceDef | null = null;
    try {
      resource = resolveResource(req);
      if (!resource.canUpdate) {
        return res.status(403).json({ error: `Não é permitido alterar registros em ${resource.label}.` });
      }

      const payload = buildWritePayload(resource, req.body || {}, true);
      validateRequired(resource, payload, true);
      await antesDeGravar(resource.name, payload, req.params.id);

      const cols = Object.keys(payload);
      if (!cols.length) return res.status(400).json({ error: 'Nenhuma alteração foi informada.' });

      const [result] = await pool.query<any>(
        `UPDATE ${resource.table} t SET ${cols.map((c) => `t.${c} = ?`).join(', ')}
          WHERE t.${pkCol(resource)} = ?`,
        [...cols.map((c) => payload[c]), req.params.id],
      );
      if (result.affectedRows === 0) {
        return res.status(404).json({ error: `${resource.labelSingular} não encontrado.` });
      }

      res.json({ success: true });
    } catch (err: any) {
      res.status(err.status || 400).json({ error: friendlyDbError(err, resource?.labelSingular) });
    }
  });

  // --------------------------------------------------------
  // Exclusão
  // --------------------------------------------------------
  router.delete('/crud/:resource/:id', async (req: Request, res: Response) => {
    let resource: ResourceDef | null = null;
    try {
      resource = resolveResource(req);
      if (!resource.canDelete) {
        return res.status(403).json({ error: `Não é permitido excluir registros em ${resource.label}.` });
      }

      await antesDeExcluir(resource.name, req.params.id);
      const [result] = await pool.query<any>(`DELETE t FROM ${resource.table} t WHERE t.${pkCol(resource)} = ?`, [req.params.id]);
      if (result.affectedRows === 0) {
        return res.status(404).json({ error: `${resource.labelSingular} não encontrado.` });
      }

      res.json({ success: true });
    } catch (err: any) {
      res.status(err.status || 400).json({ error: friendlyDbError(err, resource?.labelSingular) });
    }
  });

  return router;
}

