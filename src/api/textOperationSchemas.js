export const SPLIT_OUTPUT_FORMAT = {
  type: 'json_schema',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['world', 'regions', 'categories'],
    properties: {
      world: {
        type: 'string',
        description: '目次+要約のMarkdown本文(600〜900字程度。各regionとcategoryの一行概要を含める)',
      },
      regions: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'title', 'content'],
          properties: {
            id: { type: 'string', description: '英数字とハイフンのみのスラグ' },
            title: { type: 'string', description: 'UI表示用の具体的で読みやすい地域名(ファイル名ではない)' },
            content: { type: 'string', description: 'その地域のMarkdown詳細本文' },
          },
        },
      },
      categories: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'title', 'content'],
          properties: {
            id: { type: 'string', description: '英数字とハイフンのみのスラグ' },
            title: {
              type: 'string',
              description: 'UI表示用の具体的で読みやすいカテゴリ名(ファイル名ではない)',
            },
            content: {
              type: 'string',
              description: 'そのカテゴリの詳細本文(魔法体系・宗教・歴史・種族・組織など)',
            },
          },
        },
      },
    },
  },
};

export const SHEET_OUTPUT_FORMAT = {
  type: 'json_schema',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['name', 'goal', 'bonds'],
    properties: {
      name: {
        type: 'string',
        description: 'このキャラクターの名前(記載がなければ空文字列)',
      },
      goal: {
        type: 'string',
        description: 'このキャラクターが物語を通じて達成したいこと(記載がなければ空文字列)',
      },
      bonds: {
        type: 'string',
        description: '他PC/NPC/世界との因縁・関係(記載がなければ空文字列)',
      },
    },
  },
};
