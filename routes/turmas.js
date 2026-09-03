// routes/turmas.js - Expõe a lista canônica de salas/turmas (fonte única no backend)
const express = require('express');
const router = express.Router();
const { TURMAS } = require('../services/turmas');

// GET /api/turmas - Lista canônica de turmas para popular dropdowns no frontend
router.get('/', (req, res) => {
  res.json({ turmas: TURMAS });
});

module.exports = router;