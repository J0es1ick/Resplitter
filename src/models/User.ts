import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

@Entity()
export class User {
  @PrimaryGeneratedColumn()
  id!: number

  @Column({ type: 'bigint' })
  @Index()
  chatId!: number

  @Column({ type: 'bigint', unique: true })
  @Index()
  tgId!: number

  @Column({ 
    type: 'integer', 
    nullable: true,
    default: 1,
  })
  state: number | null = null

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt!: Date

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' })
  updatedAt!: Date
}