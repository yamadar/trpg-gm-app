import { Router } from 'express';
import { asyncHandler } from './asyncHandler.js';
import { idParamGuard } from './validateId.js';

function seq(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

export function createPartySessionsRouter({ service }) {
  const router = Router();
  router.param('id', idParamGuard);
  router.param('inviteId', idParamGuard);
  router.param('intentId', idParamGuard);
  router.param('userId', idParamGuard);

  router.post('/party-sessions', asyncHandler(async (req, res) => {
    res.status(201).json(await service.create(req.userId, req.body));
  }));

  router.get('/party-sessions', asyncHandler(async (req, res) => {
    res.json(await service.list(req.userId));
  }));

  router.get('/party-sessions/:id/snapshot', asyncHandler(async (req, res) => {
    res.json(await service.getSnapshot(req.userId, req.params.id));
  }));

  router.post('/party-sessions/:id/join', asyncHandler(async (req, res) => {
    if (typeof req.body?.inviteToken !== 'string') {
      res.status(400).json({ error: 'inviteToken is required' });
      return;
    }
    res.json(await service.join(req.userId, req.params.id, req.body.inviteToken));
  }));

  router.post('/party-sessions/:id/leave', asyncHandler(async (req, res) => {
    await service.leave(req.userId, req.params.id);
    res.status(204).end();
  }));

  router.post('/party-sessions/:id/invites', asyncHandler(async (req, res) => {
    res.status(201).json(await service.createInvite(req.userId, req.params.id, req.body));
  }));

  router.get('/party-sessions/:id/invites', asyncHandler(async (req, res) => {
    res.json(await service.invites(req.userId, req.params.id));
  }));

  router.delete('/party-sessions/:id/invites/:inviteId', asyncHandler(async (req, res) => {
    await service.revokeInvite(req.userId, req.params.id, req.params.inviteId);
    res.status(204).end();
  }));

  router.post('/party-sessions/:id/claim', asyncHandler(async (req, res) => {
    if (typeof req.body?.pcId !== 'string') {
      res.status(400).json({ error: 'pcId is required' });
      return;
    }
    res.json(await service.claimPc(req.userId, req.params.id, req.body.pcId));
  }));

  router.post('/party-sessions/:id/start', asyncHandler(async (req, res) => {
    res.json(await service.start(req.userId, req.params.id));
  }));

  router.post('/party-sessions/:id/intents', asyncHandler(async (req, res) => {
    res.status(201).json(await service.submitIntent(req.userId, req.params.id, req.body || {}));
  }));

  router.patch('/party-sessions/:id/intents/:intentId', asyncHandler(async (req, res) => {
    res.json(await service.submitIntent(req.userId, req.params.id, req.body || {}, req.params.intentId));
  }));

  router.delete('/party-sessions/:id/intents/:intentId', asyncHandler(async (req, res) => {
    await service.deleteIntent(req.userId, req.params.id, req.params.intentId);
    res.status(204).end();
  }));

  router.post('/party-sessions/:id/ready', asyncHandler(async (req, res) => {
    res.json(await service.setReady(req.userId, req.params.id, true));
  }));

  router.delete('/party-sessions/:id/ready', asyncHandler(async (req, res) => {
    res.json(await service.setReady(req.userId, req.params.id, false));
  }));

  router.post('/party-sessions/:id/typing', asyncHandler(async (req, res) => {
    res.json(await service.heartbeatTyping(req.userId, req.params.id));
  }));

  router.post('/party-sessions/:id/presence', asyncHandler(async (req, res) => {
    // snapshotを読まずに接続leaseだけ更新。直後のpollで完全なprojectionを取得する。
    res.json(await service.heartbeatPresence(req.userId, req.params.id));
  }));

  router.post('/party-sessions/:id/away', asyncHandler(async (req, res) => {
    res.json(await service.setAway(req.userId, req.params.id, req.body || {}));
  }));

  router.post('/party-sessions/:id/return', asyncHandler(async (req, res) => {
    res.json(await service.returnToParty(req.userId, req.params.id));
  }));

  router.post('/party-sessions/:id/votes', asyncHandler(async (req, res) => {
    if (typeof req.body?.optionId !== 'string') {
      res.status(400).json({ error: 'optionId is required' });
      return;
    }
    res.json(await service.vote(req.userId, req.params.id, req.body.optionId));
  }));

  router.post('/party-sessions/:id/host/advance', asyncHandler(async (req, res) => {
    res.json(await service.hostAdvance(req.userId, req.params.id));
  }));

  router.post('/party-sessions/:id/host/pause', asyncHandler(async (req, res) => {
    res.json(await service.hostPause(req.userId, req.params.id));
  }));

  router.post('/party-sessions/:id/host/resume', asyncHandler(async (req, res) => {
    res.json(await service.hostResume(req.userId, req.params.id));
  }));

  router.post('/party-sessions/:id/host/end', asyncHandler(async (req, res) => {
    res.json(await service.end(req.userId, req.params.id));
  }));

  router.patch('/party-sessions/:id/host/participants/:userId', asyncHandler(async (req, res) => {
    res.json(await service.hostUpdateParticipant(
      req.userId,
      req.params.id,
      req.params.userId,
      req.body || {},
    ));
  }));

  router.get('/party-sessions/:id/events', asyncHandler(async (req, res) => {
    res.json(await service.events(req.userId, req.params.id, seq(req.query.after)));
  }));

  router.get('/party-sessions/:id/chat', asyncHandler(async (req, res) => {
    res.json(await service.chat(req.userId, req.params.id, seq(req.query.after)));
  }));

  router.post('/party-sessions/:id/chat', asyncHandler(async (req, res) => {
    res.status(201).json(await service.sendChat(
      req.userId,
      req.params.id,
      req.body?.text,
      req.body?.commandId,
    ));
  }));

  // Serviceの既知エラーはcode/resetAtを落とさず返す。
  router.use((error, req, res, next) => {
    if (!Number.isInteger(error.status)) {
      next(error);
      return;
    }
    res.status(error.status).json({
      error: error.message,
      ...(error.code ? { code: error.code } : {}),
      ...(error.resetAt ? { resetAt: error.resetAt } : {}),
    });
  });

  return router;
}
