import {
  WebSocketGateway,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Socket } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';

interface UserInfo {
  nickname: string;
  gender: 'nam' | 'nữ' | 'khác';
  birthYear: number;
  location: string;
}

interface WaitingUser {
  userId: string;
  socketId: string;
  info: UserInfo;
}

@WebSocketGateway({ cors: { origin: '*' } }) // Cho phép CORS từ frontend
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private waitingUsers: WaitingUser[] = [];
  private activeChats: Map<
    string,
    { partnerId: string; partnerInfo: UserInfo }
  > = new Map();
  private socketToUser: Map<string, string> = new Map(); // socketId -> userId

  handleConnection(@ConnectedSocket() client: Socket) {
    const { info } = client.handshake.auth as { info: UserInfo };
    if (!info || !info.nickname || !info.location) {
      client.emit('error', { message: 'Thông tin không hợp lệ' });
      client.disconnect();
      return;
    }
    const userId = uuidv4();
    this.socketToUser.set(client.id, userId);
    console.log(`User ${userId} (${info.nickname}) connected`);
    client.emit('userId', { userId });
  }

  @SubscribeMessage('startChat')
  handleStartChat(
    @MessageBody() data: { userId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const { userId } = data;
    // Kiểm tra đã waiting chưa
    const existing = this.waitingUsers.find((u) => u.userId === userId);
    if (existing) {
      client.emit('waiting', { message: 'Đang tìm người phù hợp...' });
      return;
    }

    this.waitingUsers.push({
      userId,
      socketId: client.id,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      info: (client.handshake.auth as any).info,
    });

    // Tìm partner ngay lập tức
    const partner = this.findBestMatch({
      userId,
      socketId: client.id,
      info: (client.handshake.auth as any).info,
    });
    if (partner) {
      this.waitingUsers = this.waitingUsers.filter(
        (u) => u.userId !== partner.userId && u.userId !== userId,
      );
      this.activeChats.set(userId, {
        partnerId: partner.userId,
        partnerInfo: partner.info,
      });
      this.activeChats.set(partner.userId, {
        partnerId: userId,
        partnerInfo: (client.handshake.auth as any).info,
      });

      client.emit('matched', {
        partnerId: partner.userId,
        partnerInfo: partner.info,
      });
      client.to(partner.socketId).emit('matched', {
        partnerId: userId,
        partnerInfo: (client.handshake.auth as any).info,
      });
    } else {
      client.emit('waiting', { message: 'Đang chờ người phù hợp...' });
    }
  }

  private findBestMatch(user: WaitingUser): WaitingUser | null {
    // Ưu tiên: Giới tính ngược, tuổi gần (±5 năm), cùng khu vực
    for (const other of this.waitingUsers) {
      if (other.userId === user.userId) continue;
      const genderMatch = this.isOppositeGender(
        user.info.gender,
        other.info.gender,
      );
      const ageMatch =
        Math.abs(user.info.birthYear - other.info.birthYear) <= 5;
      const locationMatch = user.info.location === other.info.location;
      if (genderMatch && ageMatch && locationMatch) return other;
    }
    // Fallback: Ghép cùng giới hoặc khác tuổi/khu vực
    return (
      this.waitingUsers.find((other) => other.userId !== user.userId) || null
    );
  }

  private isOppositeGender(g1: string, g2: string): boolean {
    return (
      (g1 === 'nam' && g2 === 'nữ') ||
      (g1 === 'nữ' && g2 === 'nam') ||
      g1 === 'khác' ||
      g2 === 'khác'
    );
  }

  @SubscribeMessage('sendMessage')
  handleMessage(@MessageBody() data: { to: string; message: string; fileUrl?: string; type?: string }, @ConnectedSocket() client: Socket) {
    const { to, message, fileUrl, type } = data;
    const partnerSocketId = this.getSocketIdForUser(to);
    if (partnerSocketId) {
      client.to(partnerSocketId).emit('newMessage', { 
        from: this.socketToUser.get(client.id), 
        message, 
        fileUrl, 
        type 
      });
    }
  }

  @SubscribeMessage('endChat')
  handleEndChat(
    @MessageBody() data: { userId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const { userId } = data;
    const chat = this.activeChats.get(userId);
    if (chat) {
      const partnerSocketId = this.getSocketIdForUser(chat.partnerId);
      if (partnerSocketId) {
        client
          .to(partnerSocketId)
          .emit('chatEnded', { message: 'Đối phương đã kết thúc chat.' });
      }
      this.activeChats.delete(userId);
      this.activeChats.delete(chat.partnerId);
    }
  }

  handleDisconnect(@ConnectedSocket() client: Socket) {
    const userId = this.socketToUser.get(client.id);
    if (userId) {
      this.waitingUsers = this.waitingUsers.filter((u) => u.userId !== userId);
      // Cleanup active chat
      for (const [key, value] of this.activeChats.entries()) {
        if (key === userId || value.partnerId === userId) {
          const partnerSocketId = this.getSocketIdForUser(value.partnerId);
          if (partnerSocketId)
            client
              .to(partnerSocketId)
              .emit('chatEnded', { message: 'Đối phương đã ngắt kết nối.' });
          this.activeChats.delete(key);
          if (value.partnerId !== userId)
            this.activeChats.delete(value.partnerId);
          break;
        }
      }
      this.socketToUser.delete(client.id);
    }
  }

  private getSocketIdForUser(userId: string): string | null {
    for (const [socketId, uid] of this.socketToUser.entries()) {
      if (uid === userId) return socketId;
    }
    return null;
  }
}
