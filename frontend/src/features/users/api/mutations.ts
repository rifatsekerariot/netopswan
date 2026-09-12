import { mutationOptions } from '@tanstack/react-query';
import { getQueryClient } from '@/lib/query-client';
import { createUser, updateUser, deleteUser } from './service';
import { userKeys } from './queries';
import type { UserMutationPayload } from './types';

export const createUserMutation = mutationOptions({
  mutationFn: (data: UserMutationPayload) => createUser(data),
  onSuccess: () => {
    getQueryClient().invalidateQueries({ queryKey: userKeys.all });
  }
});

// NOT: `values.email` kullanıcı formda e-postayı değiştirmiş olabilir - DB satırını
// bulmak için orijinal (değişmeden önceki) `currentEmail` ayrıca gönderiliyor.
export const updateUserMutation = mutationOptions({
  mutationFn: ({
    id,
    currentEmail,
    values
  }: {
    id: number;
    currentEmail: string;
    values: UserMutationPayload;
  }) => updateUser(id, currentEmail, values),
  onSuccess: () => {
    getQueryClient().invalidateQueries({ queryKey: userKeys.all });
  }
});

// NOT: numeric `id` sadece liste sırasını temsil eder, DB satırıyla eşleşmez (bkz. service.ts) -
// bu yüzden silme işlemi için benzersiz olan `email` de gönderilmek zorunda.
export const deleteUserMutation = mutationOptions({
  mutationFn: ({ id, email }: { id: number; email: string }) => deleteUser(id, email),
  onSuccess: () => {
    getQueryClient().invalidateQueries({ queryKey: userKeys.all });
  }
});
