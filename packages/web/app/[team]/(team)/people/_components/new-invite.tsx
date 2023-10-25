"use client";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { api } from "@/trpc/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { schema } from "@tableland/studio-store";
import { Loader2, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import * as z from "zod";

const formSchema = z.object({
  email: z.string().trim().email(),
});

export default function NewInvite({ team }: { team: schema.Team }) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const inviteEmails = api.invites.inviteEmails.useMutation({
    onSuccess: () => {
      router.refresh();
      setShowForm(false);
      form.reset();
    },
  });

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      email: "",
    },
  });

  const email = form.watch("email");

  function onNewInvite() {
    setShowForm(true);
  }

  function onSubmit(values: z.infer<typeof formSchema>) {
    inviteEmails.mutate({ teamId: team.id, emails: [values.email] });
  }

  function onCancel() {
    setShowForm(false);
    form.reset();
  }

  useEffect(() => {
    if (showForm) {
      form.setFocus("email", { shouldSelect: true });
    }
  }, [form, showForm]);

  return (
    <>
      {showForm && (
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex">
            <Avatar>
              <AvatarFallback>{email.charAt(0)}</AvatarFallback>
            </Avatar>
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <Input
                      placeholder="Email address"
                      className="ml-4"
                      disabled={inviteEmails.isLoading}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage className="ml-4" />
                </FormItem>
              )}
            />
            <Button
              type="submit"
              disabled={inviteEmails.isLoading}
              className="ml-auto"
            >
              {inviteEmails.isLoading && (
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              )}
              Submit
            </Button>
            <Button
              variant="ghost"
              disabled={inviteEmails.isLoading}
              onClick={onCancel}
              className="ml-2"
            >
              Cancel
            </Button>
          </form>
        </Form>
      )}
      <Button
        variant="outline"
        className="self-start"
        disabled={showForm}
        onClick={onNewInvite}
      >
        <Plus className="mr-2" />
        New Invite
      </Button>
    </>
  );
}
