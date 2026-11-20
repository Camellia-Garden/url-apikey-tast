const rules = [
  {
    category: 'client_restricted', label: '客户端限制', tone: 'warning',
    codes: /(?:unsupported_client|client_(?:not_allowed|restricted|type_not_allowed)|coding_clients_only|unsupported_user_agent)/i,
    message: /(?:仅(?:支持|限|允许)|只(?:支持|允许)|仅供|必须(?:使用|通过))[^。\n]{0,160}(?:编程客户端|编码客户端|代码客户端|Codex|Claude Code|coding\s+(?:clients?|agents?)|CLI)|(?:only\s+(?:supports?|allows?)|restricted\s+to|must\s+use)[^.\n]{0,120}(?:coding\s+(?:clients?|agents?)|Codex|Claude Code)|(?:脚本|SDK|第三方聊天客户端)[^。\n]{0,50}(?:不支持|不允许|禁止)|(?:不支持|不允许)[^。\n]{0,50}(?:脚本|SDK\s*直连|第三方聊天客户端)/i,
    summary: '站点限制了可调用的客户端，本次网页测试无法验证模型可用性。',
    suggestion: '使用站点明确支持的编程客户端，按该站文档配置相同 URL、Key 和模型后实测喵。',
  },
  {
    category: 'balance_insufficient', label: '余额不足',
    codes: /insufficient_(?:balance|funds|credits?)|balance_(?:not_enough|insufficient)|credit_balance_too_low|billing_hard_limit_reached/i,
    message: /余额[^。\n]{0,12}(?:不足|耗尽|用尽|为零)|欠费|(?:insufficient|not enough)\s+(?:account\s+)?(?:balance|credits?|funds)|credit balance[^.\n]{0,25}(?:too low|insufficient)|run out of credits/i,
    summary: '返回信息表明账户余额或信用额度不足喵。',
    suggestion: '检查中转站余额、套餐和 Key 消费上限，补充额度后重试。',
  },
  {
    category: 'quota_exhausted', label: '配额不足',
    codes: /insufficient_quota|quota_exhausted|usage_limit_reached/i,
    message: /(?:额度|配额)[^。\n]{0,15}(?:不足|耗尽|用尽)|exceeded your current quota|(?:daily|monthly) (?:quota|limit)[^.\n]{0,20}(?:exceeded|exhausted)/i,
    summary: '当前账户、套餐或 Key 的可用配额不足喵。',
    suggestion: '检查套餐额度与 Key 限额，按站点提示等待重置或补充配额。',
  },
  {
    category: 'group_unavailable', label: '分组或渠道不可用',
    codes: /no_available_(?:channel|upstream)|channel_not_found|group_(?:not_found|unavailable)|no_channels_available/i,
    message: /分组[^。\n]{0,100}(?:不存在|不可用|无可用|没有可用|未配置|不支持)|(?:无可用|没有可用)[^。\n]{0,40}渠道|no (?:available )?channels?[^.\n]{0,100}(?:model|group)|(?:group|channel)[^.\n]{0,50}(?:not found|unavailable|does not exist)/i,
    summary: '当前 Key 所属分组没有匹配的模型或可用渠道喵。',
    suggestion: '核对 Key 分组和模型映射，可切换有权限的分组或向站点确认渠道状态。',
  },
  {
    category: 'model_unavailable', label: '模型不可用',
    codes: /model_(?:not_found|not_available|unavailable)|unknown_model|unsupported_model|model_not_exist/i,
    message: /模型[^。\n]{0,60}(?:不存在|未找到|不可用|不支持)|(?:不存在|未找到|不支持)[^。\n]{0,30}模型|(?:model)[^.\n]{0,100}(?:not found|does not exist|unavailable|not available|not supported)|(?:unknown|unsupported) model/i,
    summary: '返回信息表明该模型不存在或当前无法使用喵。',
    suggestion: '核对模型 ID 和大小写，重新获取模型列表，并确认当前分组支持该模型。',
  },
  {
    category: 'authentication_failed', label: '鉴权失败',
    codes: /invalid_(?:api_key|token|x_api_key)|authentication_error|unauthenticated|token_(?:expired|disabled)|key_(?:expired|disabled)/i,
    message: /(?:Key|密钥|令牌|token)[^。\n]{0,35}(?:无效|错误|过期|禁用|失效)|(?:无效|错误|过期|禁用)[^。\n]{0,20}(?:Key|密钥|令牌|token)|(?:invalid|incorrect|expired|disabled) (?:api[ _-]?)?(?:key|token)|authentication (?:failed|error)/i,
    summary: 'Key 无效、过期或鉴权方式不匹配喵。',
    suggestion: '检查 Key 是否完整，确认站点要求的鉴权方式和对应协议。',
  },
  {
    category: 'rate_limited', label: '请求限流',
    codes: /rate_limit(?:_exceeded|_error|ed)?|too_many_requests|concurrency_limit_exceeded/i,
    message: /限流|请求[^。\n]{0,15}频繁|并发[^。\n]{0,15}(?:上限|超限|限制)|too many requests|rate limit|requests per minute|tokens per minute/i,
    summary: '请求频率、并发数或 token 速率触发限制喵。',
    suggestion: '稍后重试，降低请求频率，并检查站点的速率与并发限制。',
  },
  {
    category: 'rate_or_quota', label: '限流或配额限制',
    codes: /resource_exhausted|(?:^|\s)quota_exceeded(?:$|\s)/i,
    message: /资源[^。\n]{0,15}耗尽|resource exhausted/i,
    summary: '返回信息表明触发了速率或资源配额限制，具体类型仍待确认喵。',
    suggestion: '结合原始返回检查账户额度与请求频率，稍后重试。',
  },
  {
    category: 'upstream_error', label: '上游异常',
    codes: /overloaded_error|upstream_(?:error|failed|unavailable)|bad_gateway|service_unavailable|server_error|api_error|internal_server_error|internal_error|overloaded|(?:^|\s)(?:UNAVAILABLE|INTERNAL)(?:$|\s)/i,
    message: /上游[^。\n]{0,50}(?:异常|错误|失败|故障|超时|不可用|无响应|出问题)|upstream[^.\n]{0,60}(?:error|failed|unavailable|timeout|timed out)|overloaded|bad gateway|service unavailable/i,
    summary: '中转站或上游服务暂时异常，当前请求未能完成喵。',
    suggestion: '稍后重试，或切换模型、渠道，并查看站点的服务状态。',
  },
  {
    category: 'permission_denied', label: '权限受限',
    codes: /permission_denied|permission_error|access_denied|forbidden|model_access_denied/i,
    message: /无权|权限不足|没有[^。\n]{0,20}权限|access denied|permission denied|do not have access/i,
    summary: '当前 Key、分组或来源没有调用权限喵。',
    suggestion: '确认 Key 的模型权限、分组、IP 白名单和站点访问要求。',
  },
  {
    category: 'content_blocked', label: '内容被拦截',
    codes: /content_policy_violation|content_filter|safety_blocked|prompt_blocked/i,
    message: /内容[^。\n]{0,20}(?:审核不通过|被拦截)|prompt (?:was )?blocked|content policy violation/i,
    summary: '测试内容触发了站点或模型的内容限制喵。',
    suggestion: '使用简短、中性的测试提示词后重试。',
  },
  {
    category: 'request_invalid', label: '请求不兼容',
    codes: /invalid_request_error|invalid_argument|unsupported_(?:parameter|value|protocol)|invalid_parameter/i,
    message: /不支持[^。\n]{0,20}(?:参数|协议)|(?:unsupported|unrecognized|unknown) (?:parameter|argument)|invalid (?:request|argument)/i,
    summary: '接口协议、路径或参数与站点要求不匹配喵。',
    suggestion: '核对站点文档中的接口协议与 API 地址，可切换流式开关后再试。',
  },
];

function result(rule, evidence, source) {
  const { codes, message, ...diagnosis } = rule;
  return { tone: 'error', ...diagnosis, ...evidence, source };
}

export function diagnose(evidence = {}) {
  const { status, upstreamMessage = '', code = '', errorType = '', kind, networkCode, timeout } = evidence;
  if (timeout || kind === 'timeout') return result({ category: 'timeout', label: '请求超时', summary: '请求未在规定时间内完成喵。', suggestion: '稍后重试，并检查站点连接或上游响应速度。' }, evidence, 'timeout');
  const codes = `${code} ${errorType}`;
  const rule = rules.find(item => item.codes.test(codes) || item.message.test(upstreamMessage));
  if (rule) return result(rule, evidence, rule.codes.test(codes) ? 'code' : 'message');
  if (networkCode) return result({ category: 'connection_error', label: '连接失败', summary: '本机未能连接中转站，或连接被中断喵。', suggestion: '检查 URL、端口、DNS、代理与 TLS 证书，并确认站点可访问。' }, evidence, 'network');
  const byStatus = {
    400: ['request_invalid', '请求不兼容', '站点认为请求格式或参数有误喵。', '核对接口地址、协议和参数，结合原始返回确认原因。'],
    401: ['authentication_failed', '鉴权失败', '站点未通过本次请求的身份验证喵。', '检查 Key 与鉴权方式，并确认 Key 有效。'],
    402: ['payment_required', '需要付费', '站点要求付费或补充可用额度喵。', '检查账户余额、套餐和付费状态。'],
    403: ['access_denied', '访问受限', '站点拒绝了当前请求，具体限制尚未确认喵。', '查看原始返回，核对权限、来源限制与 IP 白名单。'],
    404: ['route_not_found', '接口或模型未找到', '站点未找到本次请求的接口或模型喵。', '核对 API 地址、接口协议和模型 ID。'],
    405: ['request_invalid', '接口不兼容', '请求方法与站点接口不匹配喵。', '核对 URL 是否指向对应协议的 API 接口。'],
    408: ['timeout', '请求超时', '站点未能在规定时间内完成请求喵。', '稍后重试，并检查中转站连接。'],
    422: ['request_invalid', '参数校验失败', '站点未通过请求参数校验喵。', '查看原始返回中的参数要求，核对模型和协议。'],
    429: ['rate_or_quota', '限流或配额限制', '站点返回 429，现有信息不足以区分限流与配额不足喵。', '结合站点余额、配额与频率限制确认，稍后重试。'],
    504: ['timeout', '上游超时', '网关等待上游响应超时喵。', '稍后重试，或向站点确认上游服务状态。'],
  };
  if (byStatus[status]) {
    const [category, label, summary, suggestion] = byStatus[status];
    return result({ category, label, summary, suggestion }, evidence, 'http');
  }
  if (status >= 500) return result({ category: 'upstream_error', label: '服务端异常', summary: '中转站或上游服务处理本次请求时发生异常喵。', suggestion: '稍后重试，结合原始返回向站点确认故障原因。' }, evidence, 'http');
  if (status >= 300 && status < 400) return result({ category: 'redirect', label: '地址重定向', summary: '站点返回了重定向喵。', suggestion: '请直接填写站点文档提供的最终 API 地址。' }, evidence, 'http');
  const byKind = {
    empty_response: { category: kind, label: '未返回文本', summary: '请求已响应，但没有可显示的模型文本，暂未验证成功喵。', suggestion: '查看模型是否支持文本输出，或是否因输出额度、内容限制而结束。' },
    stream_interrupted: { category: kind, label: '响应中断', summary: '流式响应未正常结束，测试未完整通过喵。', suggestion: '保留已收到的输出，稍后重试或关闭流式输出对照测试。' },
    invalid_response: { category: kind, label: '响应格式不兼容', summary: '返回内容不符合所选 API 协议，暂未验证成功喵。', suggestion: '核对 API 地址和接口协议，查看原始返回是否为网页或站点提示。' },
  };
  const fallback = byKind[kind] ?? { category: 'unknown_error', label: '原因待确认', summary: '本次请求未通过，现有信息不足以确认具体原因喵。', suggestion: '查看 HTTP 状态、错误码和原始返回，必要时联系站点确认。' };
  return result(fallback, evidence, 'fallback');
}

// Generated model text is inspected only for a direct client-policy refusal.
// Ordinary discussion of billing, errors, or quoted policies remains valid output.
export function outputRestriction(text) {
  const value = text.trim();
  if (value.length > 2400 || !/^(?:[【\[][^】\]\n]{0,40}[】\]]\s*)?(?:本站|本平台|本服务|本接口|该站点|此站点|仅支持|仅限|只支持|访问受限|This\s+(?:site|service|endpoint|API)|Only\s+(?:coding|Codex)|Access\s+(?:denied|restricted))/i.test(value)) return false;
  return rules[0].message.test(value);
}
