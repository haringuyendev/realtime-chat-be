import {
    Controller,
    Post,
    UploadedFile,
    UseInterceptors,
    BadRequestException,
    Body,
  } from '@nestjs/common';
  import { FileInterceptor } from '@nestjs/platform-express';
  import { diskStorage } from 'multer';
  import { extname } from 'path';
  import { v4 as uuidv4 } from 'uuid';
  
  @Controller('upload')
  export class UploadController {
    @Post()
    @UseInterceptors(
      FileInterceptor('file', {
        storage: diskStorage({
          destination: './public/uploads',  // Thư mục lưu (tạo nếu chưa)
          filename: (req, file, cb) => {
            const uniqueName = `${Date.now()}-${uuidv4()}${extname(file.originalname)}`;
            cb(null, uniqueName);
          },
        }),
        fileFilter: (req, file, cb) => {
          if (!file.mimetype.match(/^(image\/|video\/|audio\/)/)) {
            return cb(new BadRequestException('Chỉ hỗ trợ image/video/audio!'), false);
          }
          cb(null, true);
        },
        limits: { fileSize: 10 * 1024 * 1024 },  // 10MB
      }),
    )
    uploadFile(@UploadedFile() file: Express.Multer.File, @Body() body: { type: string }) {
      if (!file) throw new BadRequestException('Không có file!');
      return {
        fileUrl: `/uploads/${file.filename}`,  // URL relative
        type: body.type || 'file',  // 'image'|'video'|'audio'
        fileName: file.originalname,
      };
    }
  }