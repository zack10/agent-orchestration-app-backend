import { connect, Connection, Channel, ConsumeMessage, ChannelModel } from 'amqplib';
import dotenv from 'dotenv';

dotenv.config();

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';
export const AGENT_EXCHANGE = 'agent_exchange';

class RabbitMQService {
  private static instance: RabbitMQService;
  private connection: Connection | null = null;
  private channel: Channel | null = null;
  private model: ChannelModel | null = null;
  private reconnecting = false;

  private constructor() {}

  public static getInstance(): RabbitMQService {
    if (!RabbitMQService.instance) {
      RabbitMQService.instance = new RabbitMQService();
    }
    return RabbitMQService.instance;
  }

  public async connect(): Promise<void> {
    if (this.connection) return;

    try {
      this.model = await connect(RABBITMQ_URL);
      this.connection = this.model.connection;
      this.channel = await this.model.createChannel();

      await this.channel.assertExchange(AGENT_EXCHANGE, 'topic', { durable: true });

      console.log('Connected to RabbitMQ');

      this.connection.on('error', (err) => {
        console.error('RabbitMQ Connection Error', err);
        this.reset();
        this.reconnect();
      });

      this.connection.on('close', () => {
        console.warn('RabbitMQ Connection Closed');
        this.reset();
        this.reconnect();
      });
    } catch (error) {
      console.error('Failed to connect to RabbitMQ', error);
      throw error;
    }
  }

  private reset() {
    this.connection = null;
    this.channel = null;
    this.model = null;
  }

  private async reconnect() {
    if (this.reconnecting) return;
    this.reconnecting = true;

    const maxRetries = 10;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const delay = Math.min(1000 * Math.pow(2, attempt - 1), 30000);
      console.log(`RabbitMQ reconnect attempt ${attempt}/${maxRetries} in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));

      try {
        await this.connect();
        console.log('RabbitMQ reconnected successfully');
        this.reconnecting = false;
        return;
      } catch {
        // continue retrying
      }
    }

    this.reconnecting = false;
    console.error('RabbitMQ reconnection failed after max retries');
  }

  public async getChannel(): Promise<Channel> {
    if (!this.channel) {
      await this.connect();
    }
    if (!this.channel) {
      throw new Error('Could not establish RabbitMQ channel');
    }
    return this.channel;
  }

  public isConnected(): boolean {
    return this.connection !== null && this.channel !== null;
  }

  public async publish(routingKey: string, message: any): Promise<void> {
    const channel = await this.getChannel();
    channel.publish(
      AGENT_EXCHANGE,
      routingKey,
      Buffer.from(JSON.stringify(message)),
      { persistent: true }
    );
  }

  public async subscribe(queueName: string, routingKey: string, onMessage: (msg: any) => void): Promise<void> {
    const channel = await this.getChannel();
    await channel.assertQueue(queueName, { durable: true });
    await channel.bindQueue(queueName, AGENT_EXCHANGE, routingKey);

    channel.consume(queueName, (msg: ConsumeMessage | null) => {
      if (msg) {
        const content = JSON.parse(msg.content.toString());
        onMessage(content);
        channel.ack(msg);
      }
    });
  }

  public async close(): Promise<void> {
    try {
      if (this.channel) await this.channel.close();
      if (this.model) await this.model.close();
    } catch (err) {
      console.error('Error closing RabbitMQ connection', err);
    } finally {
      this.reset();
    }
  }
}

export default RabbitMQService.getInstance();
