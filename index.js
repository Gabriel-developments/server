require('dotenv').config(); // Carrega variáveis de ambiente do arquivo .env
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors'); // Middleware para Cross-Origin Resource Sharing
const QRCode = require('qrcode'); // Biblioteca para gerar QR Codes
const path = require('path'); // Módulo nativo para lidar com caminhos de arquivo

// --- Configuração do App Express ---
const app = express();

// Configuração do CORS
// Para desenvolvimento local com Vite (frontend em 5173), permite requisições.
// Em produção, se o frontend for servido pelo próprio backend, o CORS é menos crítico aqui,
// mas pode ser útil se houver outros clientes ou domínios.
app.use(cors({
    origin: process.env.NODE_ENV === 'production' ? process.env.FRONTEND_URL : 'http://localhost:5173'
}));

app.use(express.json()); // Habilita o parsing de JSON no corpo das requisições

// --- Conexão com MongoDB ---
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/cardapio-digital')
  .then(() => console.log('Conectado ao MongoDB'))
  .catch(err => console.error('Erro ao conectar ao MongoDB:', err));

// --- Definição dos Modelos Mongoose ---

// Modelo de Usuário (Estabelecimento)
// Email e Senha são mantidos, mas não são mais "required" ou "unique"
// já que não há autenticação para eles neste modelo.
const Usuario = mongoose.model('Usuario', new mongoose.Schema({
  email: { type: String, unique: true, sparse: true }, // Pode ser null, mas se existir, é único
  senha: String, // Não é mais required ou hashed nesta versão
  nomeEstabelecimento: String,
  telefoneWhatsapp: String,
  endereco: String,
  horarioFuncionamento: String,
  redesSocials: [String],
  mensagemBoasVindas: String,
  corPrimaria: { type: String, default: '#4F46E5' },
  logoUrl: String, // URL da logo, não o arquivo em si
  qrCodeUrl: String, // URL do QR Code gerado
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now } // Para controle de atualização
}, { timestamps: true })); // Adiciona campos createdAt e updatedAt automaticamente

// Modelo de Categoria de Itens
const Categoria = mongoose.model('Categoria', new mongoose.Schema({
  usuarioId: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true },
  nome: { type: String, required: true },
  ordem: { type: Number, default: 0 }, // Para ordenar categorias
  ativo: { type: Boolean, default: true }, // Se a categoria deve aparecer no cardápio público
  createdAt: { type: Date, default: Date.now }
}));

// Modelo de Item do Cardápio
const Item = mongoose.model('Item', new mongoose.Schema({
  categoriaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Categoria', required: true },
  nome: { type: String, required: true },
  descricao: String,
  preco: { type: Number, required: true },
  imagemUrl: String, // URL da imagem do item
  disponivel: { type: Boolean, default: true }, // Se o item está disponível para pedido
  // Array de opções de personalização para o item
  opcoes: [{
    nome: String, // Ex: 'Tamanho', 'Adicionais', 'Ponto da Carne'
    tipo: { type: String, enum: ['unica', 'multipla', 'adicional', 'observacao'], required: true }, // 'unica' (radio), 'multipla' (checkbox), 'adicional' (checkbox com preço), 'observacao' (campo de texto)
    min: { type: Number, default: 0 }, // Mínimo de seleções para 'multipla'
    max: { type: Number, default: 1 }, // Máximo de seleções para 'multipla' (1 para 'unica')
    itens: [{ // Itens dentro da opção (ex: "Pequeno", "Médio" para "Tamanho")
      opcaoNome: String, // Ex: 'Pequeno', 'Médio', 'Grande', 'Bacon', 'Cheddar'
      precoExtra: { type: Number, default: 0 } // Preço adicional para esta sub-opção
    }]
  }],
  createdAt: { type: Date, default: Date.now }
}));

// Modelo de Pedido
const Pedido = mongoose.model('Pedido', new mongoose.Schema({
  usuarioId: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true },
  clienteNome: String,
  clienteTelefone: String,
  clienteEndereco: String, // Endereço opcional para entrega
  observacoesGerais: String, // Observações gerais do pedido
  itens: [{ // Detalhes dos itens no pedido
    itemId: { type: mongoose.Schema.Types.ObjectId, ref: 'Item', required: true },
    nome: String,
    quantidade: Number,
    precoUnitario: Number,
    opcoesSelecionadas: [{ // Opções que o cliente selecionou para este item
      nomeOpcao: String, // Ex: "Tamanho"
      selecao: mongoose.Schema.Types.Mixed, // Pode ser string (Pequeno), array de strings (Bacon, Cheddar) ou string (observacao)
      precoExtra: { type: Number, default: 0 } // Preço extra total da opção selecionada para este item
    }],
    observacoes: String, // Observações específicas para este item
  }],
  total: Number, // Valor total do pedido
  status: { type: String, enum: ['pendente', 'em preparo', 'pronto', 'entregue', 'cancelado'], default: 'pendente' },
  dataPedido: { type: Date, default: Date.now }
}));

// --- ROTAS (TODAS PÚBLICAS NESTA VERSÃO) ---

// Rotas de Usuário (Configurações do Estabelecimento)
// Para buscar um usuário específico (geralmente usado pelo painel admin)
app.get('/api/usuarios/:id', async (req, res) => {
  try {
    const usuario = await Usuario.findById(req.params.id);
    if (!usuario) return res.status(404).json({ message: 'Usuário não encontrado.' });
    res.json(usuario);
  } catch (error) {
    console.error('Erro ao buscar usuário:', error);
    res.status(500).json({ message: 'Erro ao buscar usuário', error: error.message });
  }
});

// Para criar um novo usuário (estabelecimento)
app.post('/api/usuarios', async (req, res) => {
  try {
    const { email, senha, nomeEstabelecimento, telefoneWhatsapp } = req.body; // Email e senha são opcionais agora
    
    // Validação básica para campos essenciais para o QR code e nome
    if (!nomeEstabelecimento || !telefoneWhatsapp) {
        return res.status(400).json({ message: 'Nome do estabelecimento e telefone WhatsApp são obrigatórios.' });
    }

    const novoUsuario = new Usuario({
      email,
      senha, // Sem hash
      nomeEstabelecimento,
      telefoneWhatsapp,
      mensagemBoasVindas: `Olá! Bem-vindo ao nosso cardápio digital do ${nomeEstabelecimento}! Faça seu pedido.`
    });

    await novoUsuario.save();

    // Gera o QR Code para o cardápio público
    const frontendBaseUrl = process.env.FRONTEND_URL || 'http://localhost:3000'; // URL base do frontend
    const cardapioUrl = `${frontendBaseUrl}/cardapio/${novoUsuario._id}`;
    const qrCodeUrl = await QRCode.toDataURL(cardapioUrl);
    novoUsuario.qrCodeUrl = qrCodeUrl;
    await novoUsuario.save(); // Salva o QR Code no usuário

    res.status(201).json({ message: 'Usuário criado com sucesso!', usuario: novoUsuario });
  } catch (error) {
    console.error('Erro ao criar usuário:', error);
    res.status(500).json({ message: 'Erro ao criar usuário', error: error.message });
  }
});

// Para atualizar um usuário (estabelecimento)
app.put('/api/usuarios/:id', async (req, res) => {
  try {
    const { logoUrl, telefoneWhatsapp, ...rest } = req.body; // Separa para lógica do QR code
    const usuarioAtual = await Usuario.findById(req.params.id);

    if (!usuarioAtual) {
      return res.status(404).json({ message: 'Usuário não encontrado.' });
    }

    // Atualiza os campos básicos
    Object.assign(usuarioAtual, rest);

    // Lógica para regenerar QR Code se URL da logo ou telefone mudar
    const frontendBaseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const cardapioUrl = `${frontendBaseUrl}/cardapio/${usuarioAtual._id}`;
    let shouldRegenerateQr = false;

    if (logoUrl !== undefined && usuarioAtual.logoUrl !== logoUrl) {
        usuarioAtual.logoUrl = logoUrl;
        shouldRegenerateQr = true;
    }
    if (telefoneWhatsapp !== undefined && usuarioAtual.telefoneWhatsapp !== telefoneWhatsapp) {
        usuarioAtual.telefoneWhatsapp = telefoneWhatsapp;
        shouldRegenerateQr = true;
    }
    // Se não tem QR code gerado ainda, gera na primeira atualização ou login
    if (!usuarioAtual.qrCodeUrl) {
        shouldRegenerateQr = true;
    }

    if (shouldRegenerateQr) {
        const qrCodeDataUrl = await QRCode.toDataURL(cardapioUrl);
        usuarioAtual.qrCodeUrl = qrCodeDataUrl;
    }

    await usuarioAtual.save(); // Salva todas as alterações

    res.json(usuarioAtual);
  } catch (error) {
    console.error("Erro ao atualizar usuário:", error);
    res.status(500).json({ message: 'Erro ao atualizar usuário', error: error.message });
  }
});


// Rotas de Categoria
// Para buscar categorias de um usuário (necessita usuarioId no path)
app.get('/api/categorias/:usuarioId', async (req, res) => {
  try {
    const categorias = await Categoria.find({ usuarioId: req.params.usuarioId }).sort({ ordem: 1 });
    res.json(categorias);
  } catch (error) {
    console.error('Erro ao buscar categorias:', error);
    res.status(500).json({ message: 'Erro ao buscar categorias', error: error.message });
  }
});

// Para criar uma nova categoria (necessita usuarioId no body)
app.post('/api/categorias', async (req, res) => {
  try {
    const { usuarioId, nome, ativo, ordem } = req.body;
    if (!usuarioId) return res.status(400).json({ message: 'ID do usuário é obrigatório.' });
    const novaCategoria = new Categoria({ usuarioId, nome, ativo, ordem });
    await novaCategoria.save();
    res.status(201).json(novaCategoria);
  } catch (error) {
    console.error('Erro ao criar categoria:', error);
    res.status(500).json({ message: 'Erro ao criar categoria', error: error.message });
  }
});

// Para atualizar uma categoria (necessita usuarioId no body para verificação)
app.put('/api/categorias/:id', async (req, res) => {
  try {
    const { usuarioId, ...rest } = req.body;
    if (!usuarioId) return res.status(400).json({ message: 'ID do usuário é obrigatório.' });

    const categoria = await Categoria.findOneAndUpdate(
      { _id: req.params.id, usuarioId: usuarioId }, // Garante que o usuário é o "dono" da categoria
      rest,
      { new: true } // Retorna o documento atualizado
    );
    if (!categoria) return res.status(404).json({ message: 'Categoria não encontrada ou você não tem permissão.' });
    res.json(categoria);
  } catch (error) {
    console.error('Erro ao atualizar categoria:', error);
    res.status(500).json({ message: 'Erro ao atualizar categoria', error: error.message });
  }
});

// Para deletar uma categoria (necessita usuarioId no body para verificação)
app.delete('/api/categorias/:id', async (req, res) => {
  try {
    const { usuarioId } = req.body;
    if (!usuarioId) return res.status(400).json({ message: 'ID do usuário é obrigatório.' });

    // Ao deletar uma categoria, também deleta todos os itens associados a ela
    await Item.deleteMany({ categoriaId: req.params.id });
    const result = await Categoria.findOneAndDelete({ _id: req.params.id, usuarioId: usuarioId });
    if (!result) return res.status(404).json({ message: 'Categoria não encontrada ou você não tem permissão.' });
    res.json({ message: 'Categoria e itens associados deletados com sucesso.' });
  } catch (error) {
    console.error('Erro ao deletar categoria:', error);
    res.status(500).json({ message: 'Erro ao deletar categoria', error: error.message });
  }
});


// Rotas de Item
// Para buscar itens de uma categoria
app.get('/api/itens/categoria/:categoriaId', async (req, res) => {
  try {
    const itens = await Item.find({ categoriaId: req.params.categoriaId }).sort({ nome: 1 });
    res.json(itens);
  } catch (error) {
    console.error('Erro ao buscar itens:', error);
    res.status(500).json({ message: 'Erro ao buscar itens', error: error.message });
  }
});

// Para criar um novo item
app.post('/api/itens', async (req, res) => {
  try {
    const novoItem = new Item(req.body);
    await novoItem.save();
    res.status(201).json(novoItem);
  } catch (error) {
    console.error('Erro ao criar item:', error);
    res.status(500).json({ message: 'Erro ao criar item', error: error.message });
  }
});

// Para atualizar um item
app.put('/api/itens/:id', async (req, res) => {
  try {
    const item = await Item.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!item) return res.status(404).json({ message: 'Item não encontrado.' });
    res.json(item);
  } catch (error) {
    console.error('Erro ao atualizar item:', error);
    res.status(500).json({ message: 'Erro ao atualizar item', error: error.message });
  }
});

// Para deletar um item
app.delete('/api/itens/:id', async (req, res) => {
  try {
    const item = await Item.findByIdAndDelete(req.params.id);
    if (!item) return res.status(404).json({ message: 'Item não encontrado.' });
    res.json({ message: 'Item deletado com sucesso.' });
  } catch (error) {
    console.error('Erro ao deletar item:', error);
    res.status(500).json({ message: 'Erro ao deletar item', error: error.message });
  }
});

// Rotas de Pedidos (Para o painel admin)
// Para buscar todos os pedidos de um usuário (necessita usuarioId no path)
app.get('/api/pedidos/:usuarioId', async (req, res) => {
  try {
    const pedidos = await Pedido.find({ usuarioId: req.params.usuarioId }).sort({ dataPedido: -1 });
    res.json(pedidos);
  } catch (error) {
    console.error('Erro ao buscar pedidos:', error);
    res.status(500).json({ message: 'Erro ao buscar pedidos', error: error.message });
  }
});

// Para atualizar o status de um pedido (necessita usuarioId no body para verificação)
app.put('/api/pedidos/:id', async (req, res) => {
  try {
    const { usuarioId, ...rest } = req.body;
    if (!usuarioId) return res.status(400).json({ message: 'ID do usuário é obrigatório.' });

    const pedido = await Pedido.findOneAndUpdate(
      { _id: req.params.id, usuarioId: usuarioId }, // Garante que o usuário é o "dono" do pedido
      rest,
      { new: true }
    );
    if (!pedido) return res.status(404).json({ message: 'Pedido não encontrado ou você não tem permissão.' });
    res.json(pedido);
  } catch (error) {
    console.error('Erro ao atualizar pedido:', error);
    res.status(500).json({ message: 'Erro ao atualizar pedido', error: error.message });
  }
});

// --- ROTAS PÚBLICAS (PARA O CARDÁPIO DO CLIENTE FINAL) ---

// Buscar dados do usuário (estabelecimento) para o cardápio público
app.get('/api/public/usuarios/:userId', async (req, res) => {
  try {
    const usuario = await Usuario.findById(req.params.userId).select('-senha -email -createdAt -updatedAt'); // Não enviar dados sensíveis
    if (!usuario) {
      return res.status(404).json({ message: 'Estabelecimento não encontrado.' });
    }
    res.json(usuario);
  } catch (error) {
    console.error('Erro ao buscar dados do estabelecimento público:', error);
    res.status(500).json({ message: 'Erro ao buscar dados do estabelecimento', error: error.message });
  }
});

// Buscar categorias ATIVAS de um usuário para o cardápio público
app.get('/api/public/usuarios/:userId/categorias', async (req, res) => {
  try {
    const categorias = await Categoria.find({ usuarioId: req.params.userId, ativo: true }).sort({ ordem: 1 });
    res.json(categorias);
  } catch (error) {
    console.error('Erro ao buscar categorias públicas:', error);
    res.status(500).json({ message: 'Erro ao buscar categorias', error: error.message });
  }
});

// Buscar itens de uma categoria ATIVA e DISPONÍVEIS para o cardápio público
app.get('/api/public/categorias/:categoriaId/itens', async (req, res) => {
  try {
    const itens = await Item.find({ categoriaId: req.params.categoriaId, disponivel: true }).sort({ nome: 1 });
    res.json(itens);
  } catch (error) {
    console.error('Erro ao buscar itens públicos:', error);
    res.status(500).json({ message: 'Erro ao buscar itens da categoria', error: error.message });
  }
});

// Criar Pedido (do cliente final, sem autenticação)
app.post('/api/pedidos', async (req, res) => {
  try {
    const { usuarioId, itens, clienteNome, clienteTelefone, clienteEndereco, observacoesGerais, total } = req.body;

    // Verificar se o usuário existe (o estabelecimento)
    const usuario = await Usuario.findById(usuarioId);
    if (!usuario) {
      return res.status(404).json({ message: 'Estabelecimento não encontrado.' });
    }

    const novoPedido = new Pedido({
      usuarioId,
      clienteNome,
      clienteTelefone,
      clienteEndereco,
      observacoesGerais,
      itens,
      total,
      status: 'pendente' // Status inicial
    });

    await novoPedido.save();

    // Construir mensagem para o WhatsApp
    let mensagem = `*Novo Pedido - Cardápio Digital*\n\n`;
    mensagem += `*Cliente:* ${novoPedido.clienteNome}\n`;
    mensagem += `*Telefone:* ${novoPedido.clienteTelefone}\n`;
    if (novoPedido.clienteEndereco) mensagem += `*Endereço:* ${novoPedido.clienteEndereco}\n`;
    mensagem += `*Data/Hora:* ${new Date(novoPedido.dataPedido).toLocaleString('pt-BR')}\n\n`;
    mensagem += `*Itens do Pedido:*\n`;

    novoPedido.itens.forEach(item => {
      mensagem += `- ${item.quantidade}x ${item.nome} (R$ ${item.precoUnitario.toFixed(2)} cada)\n`;
      if (item.opcoesSelecionadas && item.opcoesSelecionadas.length > 0) {
        mensagem += `  *Opções:*`;
        item.opcoesSelecionadas.forEach(opcao => {
          mensagem += `\n  - ${opcao.nomeOpcao}: ${opcao.selecao}`;
          if (opcao.precoExtra > 0) mensagem += ` (+R$ ${opcao.precoExtra.toFixed(2)})`;
        });
      }
      if (item.observacoes) mensagem += `\n  *Obs:* ${item.observacoes}`;
      mensagem += `\n`; // Adiciona uma linha vazia entre os itens para melhor leitura
    });
    
    mensagem += `\n*Total:* R$ ${novoPedido.total.toFixed(2)}`;
    if (novoPedido.observacoesGerais) mensagem += `\n\n*Observações Gerais:* ${novoPedido.observacoesGerais}`;
    
    // Retornar link do WhatsApp
    const whatsappUrl = `https://wa.me/${usuario.telefoneWhatsapp}?text=${encodeURIComponent(mensagem)}`;
    res.status(201).json({ pedido: novoPedido, whatsappUrl }); // Retorna o pedido completo e a URL do WhatsApp
  } catch (error) {
    console.error('Erro ao criar pedido:', error);
    res.status(500).json({ message: 'Erro ao criar pedido', error: error.message });
  }
});


// --- SERVIR FRONTEND EM PRODUÇÃO ---
// Esta parte DEVE vir DEPOIS de todas as suas rotas de API.
// Ela captura todas as requisições que não corresponderam a nenhuma API.

// Serve os arquivos estáticos da pasta 'build' do frontend
app.use(express.static(path.join(__dirname, '..', 'frontend', 'build')));

// Para qualquer outra rota que não seja uma API, serve o index.html do frontend
// Isso é crucial para o roteamento do React (ex: /cardapio/:id) funcionar
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'build', 'index.html'));
});


// --- Iniciar o Servidor ---
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});