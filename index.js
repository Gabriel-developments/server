require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const QRCode = require('qrcode');
const path = require('path');
const mercadopago = require('mercadopago'); // Importar Mercado Pago SDK

// Configuração do app
const app = express();
app.use(cors());
app.use(express.json());

// Conexão com MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/cardapio-digital')
  .then(() => console.log('Conectado ao MongoDB'))
  .catch(err => console.error('Erro ao conectar ao MongoDB:', err));

// --- Configuração Mercado Pago ---
mercadopago.configure({
  access_token: process.env.MP_ACCESS_TOKEN // Seu Access Token
});

// Modelos
const Usuario = mongoose.model('Usuario', new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  senha: { type: String, required: true },
  nomeEstabelecimento: String,
  telefoneWhatsapp: String,
  endereco: String,
  horarioFuncionamento: String,
  redesSociais: [String],
  mensagemBoasVindas: String,
  corPrimaria: { type: String, default: '#4F46E5' },
  logoUrl: String,
  qrCodeUrl: String,
  createdAt: { type: Date, default: Date.now },
  // NOVO CAMPO PARA ASSINATURA
  planoAssinatura: { type: String, enum: ['gratis', 'mensal', 'anual'], default: 'gratis' },
  mercadoPagoSubscriptionId: String, // ID da assinatura no Mercado Pago
  assinaturaAtiva: { type: Boolean, default: false },
  assinaturaExpiresAt: Date // Data de expiração da assinatura
}));

const Categoria = mongoose.model('Categoria', new mongoose.Schema({
  usuarioId: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true },
  nome: { type: String, required: true },
  ordem: Number
}));

const Produto = mongoose.model('Produto', new mongoose.Schema({
  usuarioId: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true },
  categoriaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Categoria' },
  nome: { type: String, required: true },
  descricao: String,
  preco: { type: Number, required: true },
  imagemUrl: String,
  ativo: { type: Boolean, default: true },
  opcoes: [{ // Exemplo: Tamanho, Sabor, etc.
    nome: String,
    tipo: { type: String, enum: ['selecao_unica', 'multipla_escolha'], default: 'selecao_unica' },
    min: { type: Number, default: 0 }, // Para múltipla escolha
    max: { type: Number, default: 1 }, // Para múltipla escolha
    itens: [{
      nome: String,
      precoExtra: { type: Number, default: 0 }
    }]
  }]
}));

const Pedido = mongoose.model('Pedido', new mongoose.Schema({
  usuarioId: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true },
  clienteNome: String,
  clienteTelefone: String,
  clienteEndereco: String,
  itens: [{
    produtoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Produto' },
    nomeProduto: String,
    precoUnitario: Number,
    quantidade: Number,
    opcoesSelecionadas: [{
      nomeOpcao: String,
      selecao: String, // ou Array de strings para múltipla escolha
      precoExtra: Number
    }],
    observacoes: String
  }],
  total: Number,
  observacoes: String,
  status: { type: String, enum: ['pendente', 'confirmado', 'cancelado', 'concluido'], default: 'pendente' },
  createdAt: { type: Date, default: Date.now }
}));


// --- Funções de Criação de Planos Mercado Pago (Executar UMA VEZ) ---
// Estes são os IDs dos planos que você obterá após criá-los manualmente
// ou via API (idealmente, crie-os via API uma vez e armazene os IDs).
// Para o propósito deste exemplo, vamos assumir que os planos já existem no MP.

const MP_PLAN_ID_MONTHLY = 'SEU_PLAN_ID_MENSAL_AQUI'; // Ex: '2456456456'
const MP_PLAN_ID_ANNUAL = 'SEU_PLAN_ID_ANUAL_AQUI';   // Ex: '9876543210'

/*
// Exemplo de como criar um plano mensal (execute este bloco uma vez para criar o plano)
// Substitua SEU_EXTERNAL_REFERENCE_MENSAL por algo único para identificar seu plano
app.post('/api/create-monthly-plan', async (req, res) => {
    try {
        const response = await mercadopago.preapproval_plan.create({
            reason: 'Assinatura Mensal Cardápio Digital',
            auto_recurring: {
                frequency: 1,
                frequency_type: 'months',
                repetitions: 0, // 0 = indefinido
                billing_day: 1,
                billing_day_proportional: false,
                transaction_amount: 29.90,
                currency_id: 'BRL'
            },
            back_url: `${process.env.APP_URL}/assinatura-confirmada`, // URL de retorno após o checkout
            status: 'active',
            external_reference: 'PLANO_MENSAL_CARDAPIO_DIGITAL_V1' // Identificador único para seu plano
        });
        console.log('Plano Mensal Criado:', response.body);
        res.status(200).json({ message: 'Plano mensal criado', planId: response.body.id });
    } catch (error) {
        console.error('Erro ao criar plano mensal:', error.message);
        res.status(500).json({ message: 'Erro ao criar plano mensal', error: error.message });
    }
});

// Exemplo de como criar um plano anual (execute este bloco uma vez para criar o plano)
// O cálculo para "2 meses grátis" é (29.90 * 10 meses) = 299.00
// Substitua SEU_EXTERNAL_REFERENCE_ANUAL por algo único para identificar seu plano
app.post('/api/create-annual-plan', async (req, res) => {
    try {
        const response = await mercadopago.preapproval_plan.create({
            reason: 'Assinatura Anual Cardápio Digital (2 meses gratis)',
            auto_recurring: {
                frequency: 1,
                frequency_type: 'years',
                repetitions: 0, // 0 = indefinido
                billing_day: 1,
                billing_day_proportional: false,
                transaction_amount: 299.00, // 29.90 * 10 meses
                currency_id: 'BRL'
            },
            back_url: `${process.env.APP_URL}/assinatura-confirmada`, // URL de retorno após o checkout
            status: 'active',
            external_reference: 'PLANO_ANUAL_CARDAPIO_DIGITAL_V1' // Identificador único para seu plano
        });
        console.log('Plano Anual Criado:', response.body);
        res.status(200).json({ message: 'Plano anual criado', planId: response.body.id });
    } catch (error) {
        console.error('Erro ao criar plano anual:', error.message);
        res.status(500).json({ message: 'Erro ao criar plano anual', error: error.message });
    }
});
*/

// --- Endpoint para Gerar Link de Assinatura ---
app.post('/api/subscriptions/create-link', async (req, res) => {
  const { planType, userId, email, nomeEstabelecimento } = req.body;

  if (!planType || !userId || !email || !nomeEstabelecimento) {
    return res.status(400).json({ message: 'Tipo de plano, ID do usuário, email e nome do estabelecimento são obrigatórios.' });
  }

  let planIdToUse;
  let reason;
  let transactionAmount;
  let frequency;
  let frequencyType;

  if (planType === 'mensal') {
    planIdToUse = MP_PLAN_ID_MONTHLY;
    reason = 'Assinatura Mensal Cardápio Digital';
    transactionAmount = 29.90;
    frequency = 1;
    frequencyType = 'months';
  } else if (planType === 'anual') {
    planIdToUse = MP_PLAN_ID_ANNUAL;
    reason = 'Assinatura Anual Cardápio Digital (2 meses gratis)';
    transactionAmount = 299.00; // R$ 29.90 * 10 meses
    frequency = 1;
    frequencyType = 'years';
  } else {
    return res.status(400).json({ message: 'Tipo de plano inválido. Use "mensal" ou "anual".' });
  }

  try {
    // Busca o usuário para garantir que ele existe e está elegível (opcional)
    const usuario = await Usuario.findById(userId);
    if (!usuario) {
      return res.status(404).json({ message: 'Usuário não encontrado.' });
    }

    // Criar uma pre-approval (assinatura)
    const preapprovalData = {
      preapproval_plan_id: planIdToUse, // ID do plano criado previamente no Mercado Pago
      reason: reason,
      payer_email: email,
      back_url: `${process.env.FRONTEND_URL}/assinatura-confirmada?user_id=${userId}&plan_type=${planType}`, // URL de retorno após o checkout
      external_reference: `${userId}_${planType}_${Date.now()}`, // Identificador único para a sua assinatura
      // Incluir detalhes do pagador, se disponíveis
      card_holder_name: nomeEstabelecimento // Usar nome do estabelecimento como nome do titular do cartão (se aplicável)
    };

    const response = await mercadopago.preapproval.create(preapprovalData);
    const checkoutLink = response.body.init_point;

    // Em um sistema real, você registraria essa tentativa de assinatura no seu DB
    // Por exemplo, criando um registro temporário ou atualizando o status do usuário para 'pendente_assinatura'

    res.status(200).json({ checkoutLink });

  } catch (error) {
    console.error('Erro ao criar link de assinatura do Mercado Pago:', error.message);
    res.status(500).json({ message: 'Erro ao gerar link de assinatura', error: error.message });
  }
});


// --- Webhook de Notificação do Mercado Pago (Opcional, mas recomendado para produção) ---
// Para um sistema robusto, você precisaria de um endpoint para o Mercado Pago enviar notificações
// sobre o status das assinaturas (pagamento aprovado, cancelado, etc.).
// Ex: app.post('/api/mercadopago/webhook', async (req, res) => { ... })
// Você precisaria configurar a URL do webhook no painel do Mercado Pago.
// Dentro do webhook, você verificaria o tipo de notificação (payment, preapproval) e
// atualizaria o status de assinatura do seu usuário no banco de dados.

// Exemplo simplificado de como você ATUALIZARIA o usuário após uma notificação
async function handleSubscriptionStatusUpdate(subscriptionId, status, userId, planType) {
    try {
        const usuario = await Usuario.findById(userId);
        if (usuario) {
            if (status === 'approved') { // Exemplo de status
                usuario.planoAssinatura = planType;
                usuario.mercadoPagoSubscriptionId = subscriptionId;
                usuario.assinaturaAtiva = true;
                // Calcule a data de expiração com base no planType (1 mês ou 1 ano)
                const expires = new Date();
                if (planType === 'mensal') {
                    expires.setMonth(expires.getMonth() + 1);
                } else if (planType === 'anual') {
                    expires.setFullYear(expires.getFullYear() + 1);
                }
                usuario.assinaturaExpiresAt = expires;
                await usuario.save();
                console.log(`Usuário ${userId} assinou o plano ${planType}.`);
            } else if (status === 'cancelled' || status === 'paused') {
                usuario.assinaturaAtiva = false;
                // Você pode manter o planoAssinatura para histórico ou reverter para 'gratis'
                await usuario.save();
                console.log(`Assinatura do usuário ${userId} foi ${status}.`);
            }
        }
    } catch (error) {
        console.error('Erro ao atualizar status de assinatura do usuário:', error.message);
    }
}


// --- Rotas existentes ---
// (Mantenha todas as suas rotas existentes aqui, como as de usuário, categoria, produto, pedido)

// Rotas de Usuário (Exemplos: Login, Registro, Perfil)
app.post('/api/usuarios/registrar', async (req, res) => {
  try {
    const { email, senha } = req.body;
    const usuario = new Usuario({ email, senha });
    await usuario.save();
    res.status(201).json({ message: 'Usuário registrado com sucesso!', userId: usuario._id });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: 'Email já cadastrado.' });
    }
    res.status(500).json({ message: 'Erro ao registrar usuário', error: error.message });
  }
});

app.post('/api/usuarios/login', async (req, res) => {
  try {
    const { email, senha } = req.body;
    const usuario = await Usuario.findOne({ email, senha }); // Em produção, use hash de senha!
    if (!usuario) {
      return res.status(401).json({ message: 'Credenciais inválidas.' });
    }
    // Em um sistema real, você geraria um JWT aqui
    res.status(200).json({ message: 'Login bem-sucedido!', userId: usuario._id, nomeEstabelecimento: usuario.nomeEstabelecimento, email: usuario.email, planoAssinatura: usuario.planoAssinatura, assinaturaAtiva: usuario.assinaturaAtiva });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao fazer login', error: error.message });
  }
});

app.get('/api/usuarios/:id', async (req, res) => {
  try {
    const usuario = await Usuario.findById(req.params.id);
    if (!usuario) {
      return res.status(404).json({ message: 'Usuário não encontrado.' });
    }
    res.json(usuario);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar usuário', error: error.message });
  }
});

app.put('/api/usuarios/:id', async (req, res) => {
  try {
    const { nomeEstabelecimento, telefoneWhatsapp, endereco, horarioFuncionamento, redesSociais, mensagemBoasVindas, corPrimaria, logoUrl } = req.body;
    const usuario = await Usuario.findByIdAndUpdate(req.params.id,
      { nomeEstabelecimento, telefoneWhatsapp, endereco, horarioFuncionamento, redesSociais, mensagemBoasVindas, corPrimaria, logoUrl },
      { new: true }
    );
    if (!usuario) {
      return res.status(404).json({ message: 'Usuário não encontrado.' });
    }
    res.json(usuario);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao atualizar usuário', error: error.message });
  }
});

app.get('/api/usuarios/:id/qrcode', async (req, res) => {
  try {
    const usuarioId = req.params.id;
    const appBaseUrl = process.env.FRONTEND_URL || `http://localhost:${process.env.PORT || 3001}`; // URL base do seu frontend
    const menuUrl = `${appBaseUrl}/menu/${usuarioId}`;

    const qrCodeDataUrl = await QRCode.toDataURL(menuUrl);
    res.json({ qrCodeUrl: qrCodeDataUrl, menuUrl });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao gerar QR Code', error: error.message });
  }
});

// Rotas de Categoria
app.get('/api/categorias/:usuarioId', async (req, res) => {
  try {
    const categorias = await Categoria.find({ usuarioId: req.params.usuarioId }).sort('ordem');
    res.json(categorias);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar categorias', error: error.message });
  }
});

app.post('/api/categorias', async (req, res) => {
  try {
    const categoria = new Categoria(req.body);
    await categoria.save();
    res.status(201).json(categoria);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao criar categoria', error: error.message });
  }
});

app.put('/api/categorias/:id', async (req, res) => {
  try {
    const categoria = await Categoria.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(categoria);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao atualizar categoria', error: error.message });
  }
});

app.delete('/api/categorias/:id', async (req, res) => {
  try {
    await Categoria.findByIdAndDelete(req.params.id);
    // Também apagar produtos associados
    await Produto.deleteMany({ categoriaId: req.params.id });
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ message: 'Erro ao deletar categoria', error: error.message });
  }
});

// Rotas de Produto
app.get('/api/produtos/:usuarioId', async (req, res) => {
  try {
    const produtos = await Produto.find({ usuarioId: req.params.usuarioId }).populate('categoriaId');
    res.json(produtos);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar produtos', error: error.message });
  }
});

app.post('/api/produtos', async (req, res) => {
  try {
    const produto = new Produto(req.body);
    await produto.save();
    res.status(201).json(produto);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao criar produto', error: error.message });
  }
});

app.put('/api/produtos/:id', async (req, res) => {
  try {
    const produto = await Produto.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(produto);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao atualizar produto', error: error.message });
  }
});

app.delete('/api/produtos/:id', async (req, res) => {
  try {
    await Produto.findByIdAndDelete(req.params.id);
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ message: 'Erro ao deletar produto', error: error.message });
  }
});

// Rotas de Pedido
app.post('/api/pedidos', async (req, res) => {
  try {
    const pedido = new Pedido(req.body);
    await pedido.save();

    const usuario = await Usuario.findById(pedido.usuarioId);
    if (!usuario || !usuario.telefoneWhatsapp) {
      return res.status(400).json({ message: 'Telefone WhatsApp do estabelecimento não configurado.' });
    }

    let mensagem = `*Novo Pedido - Cardápio Digital*\n\n*Cliente:* ${pedido.clienteNome}\n*Telefone:* ${pedido.clienteTelefone}\n`;
    if (pedido.clienteEndereco) mensagem += `*Endereço:* ${pedido.clienteEndereco}\n`;
    mensagem += `\n*Itens:*\n`;

    pedido.itens.forEach(item => {
      mensagem += `- ${item.quantidade}x ${item.nomeProduto} (R$ ${item.precoUnitario.toFixed(2)} cada)\n`;
      if (item.opcoesSelecionadas && item.opcoesSelecionadas.length > 0) {
        mensagem += `  *Opções:*`;
        item.opcoesSelecionadas.forEach(opcao => {
          mensagem += `\n  - ${opcao.nomeOpcao}: ${opcao.selecao}`;
          if (opcao.precoExtra > 0) mensagem += ` (+R$ ${opcao.precoExtra.toFixed(2)})`;
        });
      }
      if (item.observacoes) mensagem += `\n  *Obs:* ${item.observacoes}`;
    });

    mensagem += `\n\n*Total:* R$ ${pedido.total.toFixed(2)}`;
    if (pedido.observacoes) mensagem += `\n\n*Observações Gerais:* ${pedido.observacoes}`;

    // Retornar link do WhatsApp
    const whatsappUrl = `https://wa.me/${usuario.telefoneWhatsapp}?text=${encodeURIComponent(mensagem)}`;
    res.status(201).json({ pedido, whatsappUrl });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao criar pedido', error: error.message });
  }
});

app.put('/api/pedidos/:id', async (req, res) => {
  try {
    const pedido = await Pedido.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(pedido);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao atualizar pedido', error: error.message });
  }
});

// Servir frontend em produção
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '..', 'frontend', 'build')));

  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'frontend', 'build', 'index.html'));
  });
}

// Iniciar servidor
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});